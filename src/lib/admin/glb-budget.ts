/**
 * Decoded-budget pre-check for admin GLB uploads.
 *
 * Why this exists:
 *   The 60 MB Storage bucket cap is a useful UX gate but it does NOT
 *   correlate with iOS Safari's tab heap budget. A small file with a
 *   high vertex count or a 4096² texture can still OOM the iOS
 *   renderer process during decode (the /product/9dbd6623 incident).
 *   This module reads vertex count + image dimensions out of the
 *   .glb header WITHOUT loading any WASM, then refuses uploads
 *   whose decoded representation would blow past the safe budget.
 *
 *   Output is also persisted to the products table (mig 0031:
 *   glb_vertex_count, glb_max_texture_dim, glb_decoded_ram_mb) so
 *   the storefront can SSR-gate over-budget assets — see
 *   `lib/glb-display#glbUrlForGallery`.
 *
 * Pure JS / no WASM. Runs in single-digit milliseconds on an 8 MB GLB,
 * fast enough to call on every upload without UI lag. The previous
 * iteration of this module shipped alongside a Draco compression
 * pipeline (gltf-transform + draco3dgltf, ~600 KB gzipped); we tore
 * the compression out 2026-05-09 after iOS Safari kept crashing on
 * compressed-but-still-heavy assets — Jym now compresses manually
 * via https://gltf.report and uploads the result. The budget check
 * stays because a manual workflow doesn't make assets iOS-safe.
 */

/** Caps applied to admin uploads. The storefront uses STRICTER caps
 *  (lib/glb-display) — see that file for the rationale on why server-
 *  side render gating is tighter than upload-time admin gating. */
export const MAX_DECODED_VERTICES = 500_000;
export const MAX_TEXTURE_DIMENSION = 2048;
export const MAX_DECODED_RAM_MB = 120;

/** Exceeded-budget facts for the UI. All three are returned even when
 *  only one cap is busted, so a single screen of error copy can show
 *  "you're 3.7× over on verts, 2× over on texture, 1.2× over on RAM"
 *  rather than playing whack-a-mole with one violation at a time. */
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
 * Throws GlbBudgetExceededError with a multi-line message covering all
 * three caps + remediation tips if ANY cap is violated.
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

  if (exceeded.vertices || exceeded.texture || exceeded.ram) {
    throw new GlbBudgetExceededError(formatBudgetMessage(report), report);
  }
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

/** Friendly multi-line message for the dropzone — admin is English-only. */
function formatBudgetMessage(report: GlbBudgetReport): string {
  const tx = report.largestTexture;
  return [
    "This 3D model is too detailed for mobile devices.",
    `- Vertices: ${report.totalVertices.toLocaleString()} (max ${MAX_DECODED_VERTICES.toLocaleString()})`,
    `- Largest texture: ${tx ? `${tx.width}×${tx.height}` : "n/a"} (max ${MAX_TEXTURE_DIMENSION}×${MAX_TEXTURE_DIMENSION})`,
    `- Estimated decoded RAM: ${report.estimatedDecodedMb.toFixed(0)} MB (max ${MAX_DECODED_RAM_MB} MB)`,
    "",
    "Tips:",
    "- Compress at https://gltf.report (Draco mesh compression)",
    "- Or simplify mesh in Blender (Decimate modifier)",
  ].join("\n");
}
