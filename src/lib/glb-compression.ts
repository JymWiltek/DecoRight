import "server-only";

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { draco, textureCompress } from "@gltf-transform/functions";
// draco3dgltf ships the WASM encoder/decoder modules the gltf-transform
// `draco()` transform requires at runtime. The package's default export
// is a factory with `createDecoderModule` + `createEncoderModule` methods.
import draco3d from "draco3dgltf";
// Sharp is the image encoder textureCompress needs to actually re-encode
// and RESIZE textures. Without it, gltf-transform falls back to a stub
// that "ignores most quality- and compression-related options" — i.e.
// our webp quality + 2K resize would be silently dropped.
import sharp from "sharp";

import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  uploadGlbCompressedBytes,
  glbCompressedPublicUrl,
} from "@/lib/storage";
import { validateGlbBytes } from "@/lib/glb-validator";
import { MAX_COMPRESSED_OUTPUT_MB } from "@/lib/admin/glb-budget";

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
/**
 * PURE compression core — no Storage, no DB, no network. Given the raw
 * GLB bytes it validates, runs the safe transform (2K webp textures +
 * Draco), enforces the 15 MB EXIT GATE, and returns the compressed
 * bytes + sizes. Throws on validation failure or exit-gate rejection.
 * Split out from compressGlbForProduct so the pipeline (especially the
 * exit gate) is unit-testable on synthetic GLBs without a Storage
 * round-trip.
 */
export async function compressGlbBytes(originalBytes: Uint8Array): Promise<{
  compressedBytes: Uint8Array;
  originalKb: number;
  compressedKb: number;
  warnings: string[];
}> {
  const originalKb = Math.round(originalBytes.length / 1024);

  // 1. Pre-flight validate. A malformed input wastes 30-60 s of CPU
  //    if we let it through to Draco — fail fast instead.
  const validation = await validateGlbBytes(originalBytes);
  if (!validation.ok) {
    throw new Error(
      `original .glb failed Khronos validation: ${validation.errors.slice(0, 3).join("; ")}`,
    );
  }

  // 2. Wire up the Draco encoder/decoder. gltf-transform's `draco()`
  //    transform looks up these dependencies by these exact keys.
  //    Both modules ship inside the draco3dgltf npm package.
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      "draco3d.decoder": await draco3d.createDecoderModule(),
      "draco3d.encoder": await draco3d.createEncoderModule(),
    });

  // 3. Parse the binary GLB into an in-memory Document.
  const doc = await io.readBinary(originalBytes);

  // 4. Apply ONLY texture compression (jpeg/png → webp, capped at 2K)
  //    + Draco mesh compression. NEVER simplify(). NEVER meshopt(). POC
  //    Round 5 verified that any other combination either breaks
  //    rendering or destroys mesh topology.
  //
  //    Pass the sharp encoder so quality + resize actually take effect
  //    (the no-encoder fallback ignores them). resize:[2048,2048] caps
  //    every texture's longest side at 2K, preserving aspect ratio — a
  //    4096×8192 map becomes 1024×2048. This is safe (touches only image
  //    pixels, never geometry/topology, needs no runtime decoder) and it
  //    is the main lever keeping big-texture models under the 15 MB exit
  //    gate below.
  await doc.transform(
    textureCompress({
      encoder: sharp,
      targetFormat: "webp",
      quality: 85,
      resize: [2048, 2048],
    }),
    draco(),
  );

  // 5. Serialize back to binary GLB.
  const compressedBytes = await io.writeBinary(doc);
  const compressedKb = Math.round(compressedBytes.length / 1024);

  // 6. EXIT GATE. The consumer-load red line lives here now: if the
  //    compressed AR file is still over the budget, REJECT it — the
  //    caller must NOT upload it, NOT serve it. Throwing lands the row
  //    at compression_status='failed' with this reason (route handler
  //    catches), and glbUrlForGallery refuses to fall back to the raw
  //    original, so nothing over-budget reaches the storefront. Draco
  //    compresses bytes but not vertex COUNT, and we never simplify, so
  //    a still-huge output means abnormal geometry the operator must fix
  //    upstream (lower polycount), not something we can squeeze further.
  const MAX_COMPRESSED_KB = MAX_COMPRESSED_OUTPUT_MB * 1024;
  if (compressedKb > MAX_COMPRESSED_KB) {
    const compressedMb = (compressedKb / 1024).toFixed(1);
    const originalMb = (originalKb / 1024).toFixed(1);
    throw new Error(
      `压缩后仍 ${compressedMb} MB(原始 ${originalMb} MB),超过 ${MAX_COMPRESSED_OUTPUT_MB} MB AR 上限。` +
        `面数/贴图异常 —— Draco + 2K 贴图压不下来(本管线不减面,以免毁网格),请在 Tripo/Meshy 降多边形后重传。`,
    );
  }

  return { compressedBytes, originalKb, compressedKb, warnings: validation.warnings };
}

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

  // 2. Validate → transform (2K webp + Draco) → enforce exit gate. Any
  //    throw here (bad input, or compressed still > 15 MB) propagates to
  //    the route handler, which parks the row at 'failed'. Over-budget
  //    output is rejected BEFORE upload — it never reaches Storage or
  //    the storefront.
  const { compressedBytes, originalKb, compressedKb, warnings } =
    await compressGlbBytes(originalBytes);

  // 3. Upload to the compressed-glb path. Returns the public URL with
  //    a ?v=<timestamp> cache-bust (bucket has 1y Cache-Control).
  await uploadGlbCompressedBytes(productId, compressedBytes);
  const compressedPublicUrl = `${glbCompressedPublicUrl(productId)}?v=${Date.now()}`;

  return {
    originalKb,
    compressedKb,
    ratio: compressedKb / originalKb,
    compressedPublicUrl,
    warnings,
  };
}
