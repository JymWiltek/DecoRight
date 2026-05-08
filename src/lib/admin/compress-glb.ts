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
