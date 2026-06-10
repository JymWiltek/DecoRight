import "server-only";

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { draco, textureCompress } from "@gltf-transform/functions";
// draco3dgltf ships the WASM encoder/decoder modules the gltf-transform
// `draco()` transform requires at runtime. The package's default export
// is a factory with `createDecoderModule` + `createEncoderModule` methods.
import draco3d from "draco3dgltf";

import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  uploadGlbCompressedBytes,
  glbCompressedPublicUrl,
} from "@/lib/storage";
import { validateGlbBytes } from "@/lib/glb-validator";

/**
 * Wave 9 server-side Draco compression worker.
 *
 * Input:  the HIGH-QUALITY .glb at `models/products/<id>/model.glb`
 *         (40 MB typical, written by the dual-upload dropzone).
 * Output: a Draco-compressed .glb at `models/products/<id>/compressed.glb`
 *         (3-5 MB typical — POC Round 5 saw 41 MB → 3.3 MB on a 850K-vertex
 *         basin cabinet).
 *
 * Why this exact pipeline:
 *
 *   POC Round 5 tested 5 different gltf-transform configurations
 *   against `model-viewer@4.2` (storefront's renderer):
 *
 *     A: textureCompress(webp)                 39 MB → renders ✓
 *     B: meshopt() + textureCompress(webp)      7 MB → BLANK ✗
 *        ("setMeshoptDecoder must be called…" — model-viewer 4 lacks
 *         the meshopt decoder by default; loading it would add another
 *         WASM blob to the storefront bundle)
 *     C: draco() + textureCompress(webp)      3.3 MB → renders ✓
 *     D: full `optimize()` (includes simplify) 5 MB → BLANK ✗
 *        (simplify on a Meshy/Tripo mesh destroys topology)
 *     E: draco() + simplify()                  — degenerate output ✗
 *
 *   Draco + webp texture is the ONLY safe combo. Never simplify
 *   (POC Round 5 D + E confirmed it breaks the mesh). Never meshopt
 *   (model-viewer needs setMeshoptDecoder which isn't wired up).
 *
 * Memory: a 60 MB GLB peaks ~4-5× source in RSS during the
 * `transform()` call (gltf-transform holds the whole document in
 * memory). Vercel Pro default function memory is 1024 MB — fine.
 * The compression route should bump `maxDuration` to 120 s; the
 * worker itself typically finishes in 30-60 s.
 */

export type CompressionMetrics = {
  originalKb: number;
  compressedKb: number;
  /** compressedKb / originalKb — e.g. 0.08 = 92% reduction (POC Round 5). */
  ratio: number;
  /** Public URL of the compressed file with cache-bust query. Pre-built
   *  here so the caller doesn't have to re-stitch it from helpers. */
  compressedPublicUrl: string;
  /** Khronos validator warnings on the ORIGINAL — surfaced for ops
   *  visibility; do NOT fail the pipeline on warnings. */
  warnings: string[];
};

const MODELS_BUCKET = "models";

/**
 * Run the full compression pipeline for one product. Throws on any
 * unrecoverable error — the caller (route handler at
 * /api/admin/compress-glb/[id]) is responsible for catching and
 * writing `compression_status='failed'` + `compression_error`.
 *
 * The route handler also wraps THIS function in a try/catch so
 * callers can rely on never being left at status='processing' —
 * any throw lands at 'failed' instantly.
 */
export async function compressGlbForProduct(
  productId: string,
): Promise<CompressionMetrics> {
  const supabase = createServiceRoleClient();
  const sourcePath = `products/${productId}/model.glb`;

  // 1. Download the original bytes (service-role client bypasses RLS).
  const { data: originalBlob, error: dlErr } = await supabase.storage
    .from(MODELS_BUCKET)
    .download(sourcePath);
  if (dlErr) {
    throw new Error(
      `could not download original at ${sourcePath}: ${dlErr.message}`,
    );
  }
  const originalBytes = new Uint8Array(await originalBlob.arrayBuffer());
  const originalKb = Math.round(originalBytes.length / 1024);

  // 2. Pre-flight validate. A malformed input wastes 30-60 s of CPU
  //    if we let it through to Draco — fail fast instead.
  const validation = await validateGlbBytes(originalBytes);
  if (!validation.ok) {
    throw new Error(
      `original .glb failed Khronos validation: ${validation.errors.slice(0, 3).join("; ")}`,
    );
  }

  // 3. Wire up the Draco encoder/decoder. gltf-transform's `draco()`
  //    transform looks up these dependencies by these exact keys.
  //    Both modules ship inside the draco3dgltf npm package.
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      "draco3d.decoder": await draco3d.createDecoderModule(),
      "draco3d.encoder": await draco3d.createEncoderModule(),
    });

  // 4. Parse the binary GLB into an in-memory Document.
  const doc = await io.readBinary(originalBytes);

  // 5. Apply ONLY texture compression (jpeg/png → webp) + Draco mesh
  //    compression. NEVER simplify(). NEVER meshopt(). POC Round 5
  //    verified that any other combination either breaks rendering
  //    or destroys mesh topology.
  await doc.transform(
    textureCompress({ targetFormat: "webp", quality: 85 }),
    draco(),
  );

  // 6. Serialize back to binary GLB.
  const compressedBytes = await io.writeBinary(doc);
  const compressedKb = Math.round(compressedBytes.length / 1024);

  // 7. Upload to the compressed-glb path. Returns the public URL with
  //    a ?v=<timestamp> cache-bust (bucket has 1y Cache-Control).
  await uploadGlbCompressedBytes(productId, compressedBytes);
  const compressedPublicUrl = `${glbCompressedPublicUrl(productId)}?v=${Date.now()}`;

  return {
    originalKb,
    compressedKb,
    ratio: compressedKb / originalKb,
    compressedPublicUrl,
    warnings: validation.warnings,
  };
}
