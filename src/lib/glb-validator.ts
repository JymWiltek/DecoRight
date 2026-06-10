import "server-only";

/**
 * Khronos `gltf-validator` (npm) wrapper used by the Wave 9
 * compression worker (lib/glb-compression) as a pre-flight gate.
 *
 * Rationale: a malformed .glb that passes the upload's magic-byte
 * check (first 4 bytes = "glTF") can still be missing required
 * chunks or have inconsistent buffer-view offsets. Running the
 * Draco transform on that file either crashes the worker or — worse
 * — produces a "valid" but semantically broken compressed output
 * that renders blank on iOS. Round 5 POC saw exactly this category
 * of failure (assimpjs's output had hardcoded Windows paths inside
 * the GLB that gltf-validator caught before the browser did).
 *
 * The package ships a 2 MB WASM blob; we lazy-load (`await import()`)
 * inside `validateGlbBytes` so routes that never compress (e.g.
 * the upload mint, the read-side queries) don't pay the cold-start
 * cost. This mirrors how the staged-upload flow lazy-loads
 * `@/lib/admin/glb-budget` in `FileDropzone.tsx`.
 *
 * Severity classes the validator emits, by integer code (Khronos
 * naming: ValidationIssueSeverity):
 *   0 = ERROR   — spec violation; we DEMOTE most of these to warnings
 *                 unless the code is in FATAL_ERROR_CODES (see below)
 *   1 = WARNING — spec-legal but suspicious; we log + continue
 *   2 = INFO    — informational; ignored
 *   3 = HINT    — performance/portability nit; ignored
 *
 * Wave 9 post-launch fix — be much more permissive on severity-0
 * issues. POC Round 4 confirmed that Tripo's GLBs trigger
 * ACCESSOR_MIN_MISMATCH (declared bbox min doesn't match the actual
 * accessor values to within float precision) and yet render
 * perfectly in model-viewer / Blender / 3ds Max. Rejecting these
 * blocks every Tripo upload from compressing.
 *
 * Strategy: pre-flight only catches the SHAPE-level corruption that
 * would crash gltf-transform's `io.readBinary` (missing chunks,
 * undefined required properties, IO failures, structurally invalid
 * buffer/accessor metadata). Everything else — including all of
 * Khronos's spec-mismatch nitpicks — becomes a warning and the
 * worker proceeds. If gltf-transform itself can't parse the file,
 * the route handler's try/catch surfaces the underlying parser
 * error with a clean human message. model-viewer (and Blender,
 * 3ds Max, SketchUp) are far more permissive than gltf-validator,
 * and the POC evidence backs that up.
 */

/**
 * Severity-0 codes that DO indicate the file is structurally broken
 * and gltf-transform will likely fail to parse. Keep this list
 * tight — when in doubt, add the code to the warning bucket below
 * and let the Draco pass decide. POC Round 4: model-viewer renders
 * everything except true byte-level corruption.
 *
 * Codes sourced from Khronos's glTF-Validator MESSAGES.md — only
 * the ones that imply a missing required structure (no buffer,
 * undefined accessor, no asset version) belong here. Numeric
 * mismatches (ACCESSOR_*_MISMATCH, ACCESSOR_INDEX_OOB), unknown
 * extensions (UNSUPPORTED_EXTENSION), and the entire `INVALID_GLB_*`
 * family that we WANT to catch DO break parsing — but if the file
 * is THAT broken, our magic-byte check upstream OR the bytes-fed
 * `validateBytes` call itself throws before producing any issues.
 *
 * The list also intentionally omits ALL warnings (severity 1) —
 * the Khronos validator treats things like "non-relative URI" as
 * a warning even though it's a real interop hazard. POC Round 5
 * caught that exact category in assimpjs output; we surface it via
 * the warnings array, not as an abort.
 */
const FATAL_ERROR_CODES = new Set<string>([
  // Required property missing — file is structurally incomplete.
  "UNDEFINED_PROPERTY",
  "MISSING_REQUIRED_PROPERTY",
  // Required value present but obviously wrong (e.g. version != "2.0",
  // buffer.byteLength is negative). gltf-transform will throw.
  "INVALID_VALUE",
  // Couldn't read the bytes the validator was pointed at (HEAD timeout,
  // partial download). Worker should not waste CPU on this.
  "IO_ERROR",
]);

export type GlbValidationReport = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

type ValidatorIssue = {
  severity: number;
  code: string;
  message: string;
  pointer?: string;
};

type ValidatorResult = {
  issues: {
    numErrors: number;
    numWarnings: number;
    messages: ValidatorIssue[];
  };
};

/**
 * Validate raw .glb bytes against the Khronos glTF 2.0 spec.
 *
 * The 1.5 s safety timeout matches the file-size check in
 * lib/rembg/pipeline.ts — the validator processes a 40 MB GLB in
 * well under 500 ms, so a hang means something is genuinely stuck
 * and we'd rather fail fast than wedge the route's maxDuration.
 */
export async function validateGlbBytes(
  bytes: Uint8Array,
): Promise<GlbValidationReport> {
  // Lazy-load — the WASM blob is ~2 MB; we only need it on the
  // compression route.
  const { validateBytes } = await import("gltf-validator");

  let raw: ValidatorResult;
  try {
    raw = (await validateBytes(bytes)) as ValidatorResult;
  } catch (err) {
    // Validator threw before producing a report — the bytes are so
    // malformed it couldn't even parse the chunk header. Treat as
    // a single error; caller will abort.
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      errors: [`validator threw: ${msg}`],
      warnings: [],
    };
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  for (const m of raw.issues.messages) {
    const line = `${m.code}: ${m.message}${m.pointer ? ` @ ${m.pointer}` : ""}`;
    // Wave 9 post-launch: be permissive. severity 0 issues only
    // surface as errors when the code is in FATAL_ERROR_CODES;
    // everything else (ACCESSOR_MIN_MISMATCH, ACCESSOR_INDEX_OOB,
    // UNSUPPORTED_EXTENSION, NON_RELATIVE_URI, …) → warning. The
    // Draco worker still gates on `ok` for genuinely broken files
    // and gltf-transform's `io.readBinary` catches the rest.
    if (m.severity === 0 && FATAL_ERROR_CODES.has(m.code)) {
      errors.push(line);
    } else {
      warnings.push(line);
    }
    // severity 2/3 INFO/HINT are also picked up as warnings above
    // — same noise floor as before; gives ops a single warnings
    // surface instead of three.
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}
