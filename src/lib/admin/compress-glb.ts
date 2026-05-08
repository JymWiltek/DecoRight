/**
 * Client-side Draco compression for admin GLB uploads.
 *
 * Why this lives in a separate module (instead of inline in FileDropzone):
 *   1. The whole gltf-transform + draco3dgltf stack is ~600 KB gzipped
 *      (most of it WebAssembly). It MUST stay out of every chunk that
 *      doesn't actually invoke compression — i.e. every storefront
 *      surface. Putting the imports here, behind a single `compressGlb`
 *      entry, keeps Webpack/Turbopack splitting honest: only the file
 *      that calls `await import("@/lib/admin/compress-glb")` ends up
 *      with a reference to it.
 *   2. The admin dropzone calls this from a `useState`-gated effect
 *      and we want the WASM to load LAZILY on first .glb pick — not
 *      on admin page mount. Dynamic-importing this module gives us
 *      that lazy boundary for free.
 *
 * Pipeline (gltf-transform):
 *   • dedup()  — collapses duplicate accessors / textures / materials.
 *                Cheap, always wins on Meshy-generated meshes which
 *                often have separated-but-identical material slots.
 *   • prune()  — strips unused attributes / nodes / cameras / lights.
 *                Meshy and most exporters leave dangling refs; this
 *                cleans them up before Draco sees the geometry.
 *   • draco()  — KHR_draco_mesh_compression on every mesh primitive.
 *                Typical furniture-grade GLBs compress 70-90%.
 *
 * Why no texture downsizing:
 *   • Meshy emits 1024² baked PBR; downsizing to 512² loses visible
 *     detail on phone close-up zoom (the storefront's primary use case).
 *   • Draco already gives us most of the file-size win on geometry-
 *     heavy meshes, which is what 60+ MB GLBs always are.
 *   • If a .glb is texture-heavy enough that Draco-only doesn't get
 *     under 60 MB, we surface the failure to the user instead of
 *     silently degrading the asset.
 *
 * Browser compatibility:
 *   • WebAssembly required (Safari 11+ / Chrome 57+ / Firefox 52+).
 *   • Caller must catch errors and fall back to the original file —
 *     this function makes no attempt to be defensive about WASM
 *     instantiation, since the fallback path lives in FileDropzone
 *     and decides between "fall back & vet" vs "show error".
 *
 * Storefront safety:
 *   • Storefront uses <model-viewer>, which uses three.js's
 *     DRACOLoader internally and decodes KHR_draco_mesh_compression
 *     natively — no storefront code needs to change.
 */

export type GlbCompressionResult = {
  /** Compressed file ready to upload. Same name + type as input. */
  file: File;
  /** Original byte size — for the "reduced from X to Y" UI. */
  originalBytes: number;
  /** Compressed byte size. */
  compressedBytes: number;
  /**
   * 0..1 fraction by which the file shrank.
   * 0.87 means "87 % smaller".
   */
  ratio: number;
};

/**
 * Threshold under which we skip compression entirely.
 *
 * 20 MB after live experience with Meshy / Tripo exports: a typical
 * generated GLB lands at 6-15 MB. Compressing those takes 15-25 s of
 * locked main-thread time and saves a few MB on storage — but the
 * uncompressed file uploads in ~1 s on any reasonable connection,
 * and the storage delta costs cents per month. The wait isn't worth
 * the spend.
 *
 * Above 20 MB we always compress: that's the band where uploads
 * actually start hurting (60 MB bucket cap, 30+ s upload on slow
 * networks, real GPU upload pain on the storefront), so the
 * compression CPU pays for itself in real-world bandwidth + render-
 * time savings.
 *
 * Earlier value: 5 MB (commit 1f87e25). Bumped per Jym's feedback —
 * Meshy outputs in the 6-15 MB range were forcing 20 s spinners with
 * no perceivable upside vs. uploading raw.
 */
export const COMPRESS_THRESHOLD_BYTES = 20 * 1024 * 1024;

/**
 * Hard ceiling above which we refuse to even attempt compression.
 *
 * Why we need this:
 *   Draco runs on the main thread (gltf-transform's WebIO has no
 *   built-in worker offload). On a ~70 MB file the freeze is ~30 s,
 *   tolerable. On a 300 MB file it locks the tab for several minutes
 *   AND can OOM the renderer — the user can't even see the
 *   "Compressing…" spinner spinning. Pre-rejecting saves them from
 *   that experience.
 *
 * 250 MB picked because:
 *   • Draco typically compresses a furniture GLB by 70–90 %. Even
 *     under the optimistic 90 % case, a 250 MB input would leave
 *     ~25 MB compressed — comfortably under the 60 MB cap. Above
 *     250 MB the user is past the typical Meshy export ceiling and
 *     should hand-optimize before uploading anyway.
 *   • Fits comfortably under the typical browser tab heap budget
 *     (~2 GB on desktop Chrome) once you account for the bytes being
 *     duplicated through ArrayBuffer → File → Uint8Array → Draco
 *     internal copies. >250 MB risks OOM mid-encode.
 *
 * Above this threshold, compressGlb throws a `TooLargeError` whose
 * `originalBytes` field carries the input size for the UI to render
 * an honest "X MB exceeds the compressor's 250 MB ceiling — please
 * decimate manually first" error.
 */
export const PRE_COMPRESSION_HARD_CEILING_BYTES = 250 * 1024 * 1024;

/**
 * Decoded-budget caps — applied to every staged GLB regardless of
 * whether it went through Draco compression.
 *
 * Why: file size is a poor predictor of iOS Safari renderer-process
 * survival. A Draco-compressed 8 MB GLB can decode to >100 MB of
 * vertex data + texture RAM, which iOS Safari kills the tab over
 * (see /product/9dbd6623 incident, 2026-05-09 0:47 UTC). Checking
 * decoded size — vertex count + texture dimensions — gates uploads
 * on the actual mobile-fitness invariant the 60 MB pre-compression
 * cap used to provide implicitly.
 *
 * Numbers picked against the 9dbd6623 baseline: 1.01 M verts +
 * 4096² texture + ~140 MB decoded RAM. We pick caps that would
 * have rejected it with margin to spare while not-rejecting the
 * pre-compression-era working assets (Silver Bathtub, Marble
 * Basin etc., all comfortably under 200K verts and 2048² textures).
 */
export const MAX_DECODED_VERTICES = 500_000;
export const MAX_TEXTURE_DIMENSION = 2048;
export const MAX_DECODED_RAM_MB = 120;

/** Custom error so the caller can branch on size-cap violations vs.
 *  arbitrary parse / encode failures. The latter still falls back to
 *  the original file; the former does not, since the original is by
 *  definition over the bucket cap. */
export class GlbTooLargeError extends Error {
  readonly originalBytes: number;
  readonly ceilingBytes: number;
  constructor(originalBytes: number, ceilingBytes: number) {
    super(
      `glb is ${(originalBytes / 1024 / 1024).toFixed(1)} MB which is above the ${(
        ceilingBytes /
        1024 /
        1024
      ).toFixed(0)} MB pre-compression ceiling`,
    );
    this.name = "GlbTooLargeError";
    this.originalBytes = originalBytes;
    this.ceilingBytes = ceilingBytes;
  }
}

/**
 * Compress a .glb file with the gltf-transform + Draco pipeline.
 *
 * The function dynamically imports its dependencies on first call,
 * so the cost of the lazy bundle hits the user once per session, on
 * their first .glb pick. Subsequent calls reuse the modules from
 * the module cache — and the WASM bytes from the browser's HTTP cache.
 *
 * Throws if any stage fails (parse, transform, encode). Caller is
 * expected to fall back to the original file on throw.
 */
export async function compressGlb(file: File): Promise<GlbCompressionResult> {
  const originalBytes = file.size;

  // Refuse to engage Draco on pathological inputs — see the
  // PRE_COMPRESSION_HARD_CEILING_BYTES doc comment for the freeze /
  // OOM rationale. Caller is expected to surface a friendly
  // "decimate manually first" message; we deliberately do NOT fall
  // back to the original file here, because by definition it's far
  // above the bucket cap.
  if (originalBytes > PRE_COMPRESSION_HARD_CEILING_BYTES) {
    throw new GlbTooLargeError(originalBytes, PRE_COMPRESSION_HARD_CEILING_BYTES);
  }

  // Skip the round-trip for already-small files. We still return a
  // GlbCompressionResult so the caller can use a uniform code path.
  if (originalBytes < COMPRESS_THRESHOLD_BYTES) {
    return {
      file,
      originalBytes,
      compressedBytes: originalBytes,
      ratio: 0,
    };
  }

  // Dynamic imports — keep this stack out of every other bundle.
  // Promise.all so the four chunks come down in parallel.
  const [coreMod, extMod, fnMod, dracoMod] = await Promise.all([
    import("@gltf-transform/core"),
    import("@gltf-transform/extensions"),
    import("@gltf-transform/functions"),
    import("draco3dgltf"),
  ]);

  const { WebIO } = coreMod;
  const { ALL_EXTENSIONS } = extMod;
  const { dedup, prune, draco } = fnMod;

  // draco3dgltf ships both encoder and decoder; gltf-transform's
  // draco() function needs both. createEncoderModule / Decoder are
  // async — they instantiate the underlying WASM and resolve when it's
  // ready. The browser caches the .wasm file via its HTTP cache,
  // so the second visit reuses the bytes.
  //
  // locateFile shim: draco3dgltf's Emscripten glue tries to fetch
  // its .wasm files from the same URL as the JS module. Bundled by
  // Turbopack the JS module sits at some `/_next/static/chunks/…`
  // path, where the .wasm is NOT served — fetch returns 404 and the
  // module aborts with "both async and sync fetching of the wasm
  // failed". Pointing locateFile at /draco/<file> makes Emscripten
  // fetch the WASM from public/draco/ where the post-install copy
  // step (see scripts/copy-draco-wasm.mjs) places them.
  const draco3d = dracoMod.default ?? dracoMod;
  const locateFile = (file: string) => `/draco/${file}`;
  type Factory = (mod?: { locateFile: (file: string) => string }) => Promise<unknown>;
  const [dracoEncoder, dracoDecoder] = await Promise.all([
    (draco3d as { createEncoderModule: Factory }).createEncoderModule({ locateFile }),
    (draco3d as { createDecoderModule: Factory }).createDecoderModule({ locateFile }),
  ]);

  const io = new WebIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      "draco3d.encoder": dracoEncoder,
      "draco3d.decoder": dracoDecoder,
    });

  // Read → transform → write. WebIO.readBinary expects a Uint8Array.
  // file.arrayBuffer() returns an ArrayBuffer in browsers; wrap it.
  const inputBytes = new Uint8Array(await file.arrayBuffer());
  const document = await io.readBinary(inputBytes);

  await document.transform(dedup(), prune(), draco());

  const outputBytes = await io.writeBinary(document);
  const compressedBytes = outputBytes.byteLength;

  // Construct a new File with the same name + MIME so downstream
  // upload code (filename for storage path, MIME header) doesn't
  // change a thing.
  //
  // Why .slice().buffer: lib.dom's File constructor wants a BlobPart,
  // and TS narrows Uint8Array<ArrayBufferLike> in a way that's not
  // assignable to BlobPart on this lib target (the union includes
  // SharedArrayBuffer). Slicing into a plain ArrayBuffer side-steps
  // the variance issue without copying twice — `.slice()` on a
  // Uint8Array returns a fresh Uint8Array with its own ArrayBuffer.
  const outBuffer = outputBytes.slice().buffer;
  const compressedFile = new File([outBuffer], file.name, {
    type: file.type || "model/gltf-binary",
    lastModified: Date.now(),
  });

  // Floor at 0 in the unlikely case Draco made it bigger (it can,
  // marginally, on tiny meshes — we only get here for files ≥ 20 MB
  // where compression virtually always wins, but defend anyway so
  // the UI doesn't show "-2 % smaller").
  const ratio = Math.max(0, 1 - compressedBytes / originalBytes);

  return {
    file: compressedFile,
    originalBytes,
    compressedBytes,
    ratio,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Decoded-budget pre-check (post-compression / pre-upload)
// ─────────────────────────────────────────────────────────────────────

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
 *                      gltf-transform: parsing a few bytes is cheap and
 *                      keeps this checker out of the WASM path so it
 *                      can run on every upload, including small files
 *                      under the compression threshold (5-20 MB band
 *                      where compressGlb is skipped).
 *   • estimatedDecodedMb — vertices × 36 (POSITION + NORMAL + UV0 as
 *                      f32) + Σ texture × 4 bytes (RGBA8 as the GPU
 *                      sees it). 36 is the typical attribute-channel
 *                      cost for a furniture mesh; some files have
 *                      tangents too, but using 36 keeps the cap
 *                      generous rather than punishing.
 *
 * Throws GlbBudgetExceededError with a multi-line message covering all
 * three caps + remediation tips if ANY cap is violated.
 *
 * Pure JS / no WASM. Runs in single-digit milliseconds on an 8 MB GLB
 * — fast enough to call on every upload without UI lag.
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
    "- Try Tripo (lower poly count by default)",
    "- Or simplify mesh in Blender (Decimate modifier)",
  ].join("\n");
}
