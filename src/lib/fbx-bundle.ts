import "server-only";

import JSZip from "jszip";

import {
  downloadModelObject,
  listProductTextures,
  uploadFbxBundleZip,
} from "@/lib/storage";

/**
 * Wave 11b — package a product's FBX + its texture maps into one zip
 * a designer can download and drop straight into 3ds Max.
 *
 * Why a zip at all: a bare .fbx loads materialless (black/grey) in
 * 3ds Max — the FBX references its texture maps by filename, and the
 * importer resolves them from a sibling `textures/` folder. Shipping
 *
 *   fbx-bundle.zip
 *   ├── model.fbx
 *   └── textures/
 *       ├── basecolor.jpg
 *       └── normal.png
 *
 * means the designer unzips once and the import auto-resolves every
 * map. This mirrors how Tripo / Meshy export their FBX archives, so
 * it's the layout designers already expect.
 *
 * Pure JS (jszip) — deliberately NOT archiver. archiver pulls native
 * zlib bindings that Vercel's serverless tracer can miss (same class
 * of bug as the Wave 9 Draco WASM omission). jszip is pure JS and
 * bundles cleanly.
 *
 * Memory: the .fbx is up to 100 MB; jszip holds the input + the
 * compressed output in memory. On a 1 GB Vercel function that's fine
 * for one product. We use DEFLATE level 6 (jszip default) — textures
 * are already-compressed JPEG/PNG so they barely shrink, but the
 * .fbx (plain binary) compresses ~30-50%, which is worth the CPU.
 */

export type BundleResult = {
  /** Public URL of the uploaded zip, with ?v= cache-bust. */
  url: string;
  /** Zip size in KB (for the products.fbx_bundle_size_kb column). */
  sizeKb: number;
  /** Number of texture maps folded in (for ops logging / UI). */
  textureCount: number;
};

export class NoFbxError extends Error {
  constructor() {
    super("product has no .fbx to bundle");
    this.name = "NoFbxError";
  }
}

/**
 * Build + upload the zip for one product. Throws NoFbxError when the
 * product has no uploaded .fbx (caller should surface "upload an FBX
 * first"). Textures are optional — a zip with just model.fbx is still
 * valid (the designer at least gets the geometry), though the whole
 * point is to include maps, so the caller's UI should nudge the
 * operator to add them.
 */
export async function packageFbxBundle(
  productId: string,
): Promise<BundleResult> {
  const fbxPath = `products/${productId}/model.fbx`;

  // 1. Pull the .fbx. download throws if the object is missing —
  //    translate that into the typed NoFbxError so the caller can
  //    show a clean message instead of a raw storage error.
  let fbxBytes: Uint8Array;
  try {
    fbxBytes = await downloadModelObject(fbxPath);
  } catch {
    throw new NoFbxError();
  }

  // 2. Enumerate + pull every texture map.
  const texturePaths = await listProductTextures(productId);
  const textures: Array<{ name: string; bytes: Uint8Array }> = [];
  for (const path of texturePaths) {
    const name = path.split("/").pop()!;
    const bytes = await downloadModelObject(path);
    textures.push({ name, bytes });
  }

  // 3. Assemble the zip. model.fbx at root, maps under textures/.
  const zip = new JSZip();
  zip.file("model.fbx", fbxBytes);
  if (textures.length > 0) {
    const dir = zip.folder("textures")!;
    for (const t of textures) dir.file(t.name, t.bytes);
  }
  const zipBytes = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  // 4. Upload + return metrics.
  const url = await uploadFbxBundleZip(productId, zipBytes);
  return {
    url,
    sizeKb: Math.round(zipBytes.length / 1024),
    textureCount: textures.length,
  };
}
