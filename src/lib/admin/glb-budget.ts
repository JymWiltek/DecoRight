/**
 * Decoded-budget METADATA reader for admin GLB uploads.
 *
 * What this used to be (pre-Wave-9):
 *   A hard upload gate. The module read vertex count + image
 *   dimensions out of the .glb header and REFUSED uploads whose
 *   decoded representation would blow past iOS Safari's tab heap
 *   budget. Operators had to manually compress at gltf.report before
 *   re-trying.
 *
 * What it is now (Wave 9):
 *   Just a metadata reader. Wave 9's server-side Draco pipeline
 *   auto-compresses every uploaded .glb to a 3-5 MB AR file (see
 *   `lib/glb-compression`), so the iOS OOM risk that motivated the
 *   gate no longer applies to what the storefront actually serves.
 *   We still compute the report and persist it (mig 0031:
 *   glb_vertex_count, glb_max_texture_dim, glb_decoded_ram_mb)
 *   because legacy products without compression metadata still hit
 *   the SSR gate in `lib/glb-display#glbUrlForGallery` — that gate
 *   reads these columns to decide whether to mount <model-viewer>
 *   for un-compressed-yet products.
 *
 *   The Wave 9 fix: never THROW from this module. Callers always get
 *   the report back, never an exception. Parse failures (genuine
 *   corruption — bad magic, malformed JSON chunk) still throw, but
 *   "too many vertices for mobile" no longer blocks the upload.
 *
 * Pure JS / no WASM. Runs in single-digit milliseconds on an 8 MB GLB,
 * fast enough to call on every upload without UI lag.
 */

/** Decoded-budget caps. Kept for backward-compat with the report's
 *  `exceeded` flags (DB consumers + the legacy SSR gate read these),
 *  but Wave 9 NO LONGER throws when they're busted. The storefront's
 *  `glbUrlForGallery` reads the persisted metadata + these caps to
 *  decide whether to mount <model-viewer> for un-compressed-yet
 *  products. */
export const MAX_DECODED_VERTICES = 500_000;
export const MAX_TEXTURE_DIMENSION = 2048;
export const MAX_DECODED_RAM_MB = 120;

/** Decoded-budget facts persisted to products columns and read by
 *  the storefront SSR gate. The `exceeded` flags are still computed
 *  (legacy products without Wave 9 compression metadata use them in
 *  `lib/glb-display#glbUrlForGallery`), but Wave 9 NO LONGER refuses
 *  uploads based on them — the server-side Draco worker normalizes
 *  every accepted GLB into a 3-5 MB AR file regardless. */
export type GlbBudgetReport = {
  totalVertices: number;
  largestTexture: { width: number; height: number } | null;
  estimatedDecodedMb: number;
  exceeded: {
    vertices: boolean;
    texture: boolean;
    ram: boolean;
  };
};

/**
 * Wave 9 kept the class but never throws it from `checkGlbBudget`.
 * The two dropzone consumers (FileDropzone, ProductDraftCard) still
 * have `instanceof GlbBudgetExceededError` catch branches; they're
 * now dead-but-harmless and compile clean. If we ever bring back a
 * hard gate (e.g. on raw byte size beyond the bucket cap) this is
 * the surface to throw it from again.
 *
 * @deprecated Wave 9 — checkGlbBudget no longer throws this. The
 *   server-side compression worker handles every accepted GLB.
 */
export class GlbBudgetExceededError extends Error {
  readonly report: GlbBudgetReport;
  constructor(message: string, report: GlbBudgetReport) {
    super(message);
    this.name = "GlbBudgetExceededError";
    this.report = report;
  }
}

/**
 * Inspect a staged GLB's metadata + image headers and reject if the
 * decoded representation would blow past iOS Safari's tab-heap budget.
 *
 * What we compute:
 *   • totalVertices  — sum of accessor.count for every primitive's
 *                      POSITION attribute (a Draco-compressed POSITION
 *                      accessor still reports the same count; Draco
 *                      compresses the bytes, not the vertex count).
 *   • largestTexture — max(width, height) over all images. We decode
 *                      JPEG and PNG headers ourselves rather than pulling
 *                      a third-party glTF lib: parsing a few bytes is
 *                      cheap, deterministic, and keeps this module
 *                      WASM-free.
 *   • estimatedDecodedMb — vertices × 36 (POSITION + NORMAL + UV0 as
 *                      f32) + Σ texture × 4 bytes (RGBA8 as the GPU
 *                      sees it). 36 is the typical attribute-channel
 *                      cost for a furniture mesh; some files have
 *                      tangents too, but using 36 keeps the cap
 *                      generous rather than punishing.
 *
 * Wave 9 — never throws on cap violations. Parse failures still
 * throw (bad magic, corrupted JSON chunk). Callers should treat the
 * report's `exceeded` flags as advisory metadata, NOT a gate.
 */
export async function checkGlbBudget(file: File): Promise<GlbBudgetReport> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { json, binChunkOffset } = parseGlbHeader(bytes);

  // Total vertex count: sum POSITION accessor.count across all primitives.
  // Multiple primitives in one mesh count separately (each has its own
  // vertex buffer in WebGL) so the sum represents real GPU/RAM cost.
  let totalVertices = 0;
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      const posAccIdx = prim.attributes?.POSITION;
      if (typeof posAccIdx !== "number") continue;
      const acc = json.accessors?.[posAccIdx];
      if (!acc || typeof acc.count !== "number") continue;
      totalVertices += acc.count;
    }
  }

  // Largest texture dimension across all images. We need actual width/
  // height — neither is stored in the glTF JSON, so peek at the image
  // bytes (JPEG SOFn / PNG IHDR).
  let largestTexture: { width: number; height: number } | null = null;
  let textureRamBytes = 0;
  for (const image of json.images ?? []) {
    const dim = await readImageDimensions(bytes, json, image, binChunkOffset);
    if (!dim) continue;
    if (
      !largestTexture ||
      Math.max(dim.width, dim.height) >
        Math.max(largestTexture.width, largestTexture.height)
    ) {
      largestTexture = dim;
    }
    textureRamBytes += dim.width * dim.height * 4; // RGBA8 GPU upload
  }

  const vertexRamBytes = totalVertices * 36; // POSITION+NORMAL+UV0 floats
  const estimatedDecodedMb = (vertexRamBytes + textureRamBytes) / 1_048_576;

  const exceeded = {
    vertices: totalVertices > MAX_DECODED_VERTICES,
    texture:
      !!largestTexture &&
      Math.max(largestTexture.width, largestTexture.height) >
        MAX_TEXTURE_DIMENSION,
    ram: estimatedDecodedMb > MAX_DECODED_RAM_MB,
  };

  const report: GlbBudgetReport = {
    totalVertices,
    largestTexture,
    estimatedDecodedMb,
    exceeded,
  };

  // Wave 9 — DO NOT throw on cap violations. The server-side Draco
  // worker (lib/glb-compression) normalizes every accepted GLB into
  // a 3-5 MB AR file regardless of how much over the mobile caps the
  // original is. The legacy SSR gate still reads the persisted
  // metadata for un-compressed-yet rows, but admin upload no longer
  // bounces operators with "compress at gltf.report first" — that
  // workflow is the system's job now. `exceeded` flags stay populated
  // so the report's downstream consumers can still inspect them.
  return report;
}

/**
 * Parse the GLB binary container header.
 *
 * Layout (per glTF 2.0 spec):
 *   • 12 bytes header: magic (4) | version (4) | totalLength (4)
 *   • Chunk 0: JSON — length (4) | type='JSON' (4) | json bytes
 *   • Chunk 1 (optional): BIN — length (4) | type='BIN\0' (4) | binary bytes
 *
 * Returns the parsed JSON plus the offset into `bytes` where the BIN
 * chunk starts (or null if absent). All field offsets are little-endian
 * per spec.
 */
function parseGlbHeader(bytes: Uint8Array): {
  json: GltfJson;
  binChunkOffset: number | null;
} {
  if (bytes.length < 12) throw new Error("not a glb (too short)");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Magic: "glTF"
  if (view.getUint32(0, true) !== 0x46546c67) {
    throw new Error("not a glb (bad magic)");
  }
  // Skip version (offset 4) + totalLength (offset 8). 12-byte header.
  let off = 12;
  const jsonLen = view.getUint32(off, true);
  const jsonType = view.getUint32(off + 4, true);
  // 'JSON' little-endian: 0x4E4F534A
  if (jsonType !== 0x4e4f534a) throw new Error("not a glb (chunk 0 not JSON)");
  off += 8;
  const jsonText = new TextDecoder().decode(bytes.subarray(off, off + jsonLen));
  const json = JSON.parse(jsonText) as GltfJson;
  off += jsonLen;
  // Optional BIN chunk.
  let binChunkOffset: number | null = null;
  if (off + 8 <= bytes.length) {
    const binLen = view.getUint32(off, true);
    const binType = view.getUint32(off + 4, true);
    // 'BIN\0' little-endian: 0x004E4942
    if (binType === 0x004e4942) {
      binChunkOffset = off + 8;
      // binLen bytes follow; we don't read them here, callers slice later.
      void binLen;
    }
  }
  return { json, binChunkOffset };
}

/** Minimal glTF JSON shape — only the fields we read. */
type GltfJson = {
  accessors?: Array<{ count?: number }>;
  meshes?: Array<{
    primitives?: Array<{
      attributes?: { POSITION?: number };
    }>;
  }>;
  images?: Array<{
    mimeType?: string;
    bufferView?: number;
    uri?: string;
  }>;
  bufferViews?: Array<{
    buffer?: number;
    byteOffset?: number;
    byteLength?: number;
  }>;
};

/**
 * Resolve an image entry's bytes and decode JPEG SOFn or PNG IHDR
 * to read width / height. Returns null for unsupported MIME types
 * (WebP, KTX2 — out of scope until we see them in the wild).
 */
async function readImageDimensions(
  glbBytes: Uint8Array,
  json: GltfJson,
  image: NonNullable<GltfJson["images"]>[number],
  binChunkOffset: number | null,
): Promise<{ width: number; height: number } | null> {
  let imgBytes: Uint8Array | null = null;

  if (typeof image.bufferView === "number") {
    const bv = json.bufferViews?.[image.bufferView];
    if (!bv) return null;
    if (binChunkOffset === null) return null;
    const start = binChunkOffset + (bv.byteOffset ?? 0);
    const end = start + (bv.byteLength ?? 0);
    if (end > glbBytes.length) return null;
    imgBytes = glbBytes.subarray(start, end);
  } else if (typeof image.uri === "string" && image.uri.startsWith("data:")) {
    // data URI fallback — rare in GLB but spec-legal
    const comma = image.uri.indexOf(",");
    if (comma < 0) return null;
    const b64 = image.uri.slice(comma + 1);
    const bin = atob(b64);
    imgBytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) imgBytes[i] = bin.charCodeAt(i);
  } else {
    // External URI — won't fetch here; assume unknown.
    return null;
  }

  const mime = image.mimeType ?? sniffMime(imgBytes);
  if (mime === "image/jpeg") return readJpegDimensions(imgBytes);
  if (mime === "image/png") return readPngDimensions(imgBytes);
  return null; // WebP / KTX2 / unknown — skip.
}

/** Sniff MIME from magic bytes — used when the glTF entry omits mimeType. */
function sniffMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  return null;
}

/**
 * Walk JPEG markers until we hit a Start-Of-Frame (SOFn) marker, which
 * encodes height/width. Most encoders emit exactly one SOFn early in
 * the stream; we never have to traverse far.
 *
 * Marker layout: FF Cn LL LL P HH HH WW WW ...
 *   • SOFn = 0xFFC0..0xFFCF except 0xFFC4 (DHT), 0xFFC8 (JPG), 0xFFCC (DAC)
 *   • LL LL: segment length including these 2 bytes (big-endian)
 *   • P: precision byte
 *   • HH HH: height (big-endian 16-bit)
 *   • WW WW: width (big-endian 16-bit)
 */
function readJpegDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null; // not JPEG
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null; // mis-aligned
    // Skip filler 0xFF bytes
    while (bytes[i] === 0xff && i < bytes.length) i++;
    const marker = bytes[i];
    i++;
    // Standalone markers — no payload, no length
    if (marker === 0xd8 || marker === 0xd9) return null;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    // Need 2 bytes for segment length
    if (i + 1 >= bytes.length) return null;
    const segLen = (bytes[i] << 8) | bytes[i + 1];
    // SOFn: 0xC0..0xCF except 0xC4, 0xC8, 0xCC
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isSof) {
      // i points at segLen high byte. Layout from i: LL LL P HH HH WW WW
      if (i + 6 >= bytes.length) return null;
      const height = (bytes[i + 3] << 8) | bytes[i + 4];
      const width = (bytes[i + 5] << 8) | bytes[i + 6];
      return { width, height };
    }
    i += segLen; // segLen includes the LL LL bytes themselves
  }
  return null;
}

/**
 * PNG: 8-byte signature, then the IHDR chunk is always first.
 * IHDR layout: [4-byte length=13][4-byte type='IHDR'][4-byte width][4-byte height]...
 * Width/height are big-endian 32-bit.
 */
function readPngDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  if (
    bytes.length < 24 ||
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47
  ) {
    return null;
  }
  // Skip 8-byte signature + 4-byte chunk length + 4-byte 'IHDR'
  // → width starts at offset 16
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = v.getUint32(16, false);
  const height = v.getUint32(20, false);
  return { width, height };
}

// Wave 9 — `formatBudgetMessage` removed alongside the throw above.
// If a future hard gate comes back (e.g. raw byte size > storage
// bucket cap), reinstate a focused message instead of resurrecting
// the old "compress at gltf.report" / "simplify in Blender" copy —
// the server-side Draco worker has made both pieces of advice
// obsolete for ordinary mobile-budget violations.
