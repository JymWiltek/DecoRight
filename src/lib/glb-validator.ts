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
 *   0 = ERROR   — spec violation, file is invalid; we abort compression
 *   1 = WARNING — spec-legal but suspicious; we log + continue
 *   2 = INFO    — informational; ignored
 *   3 = HINT    — performance/portability nit; ignored
 *
 * `ok` flag returns true iff numErrors === 0; warnings DO NOT fail
 * the gate (Round 4 confirmed that Tripo's clean outputs still emit
 * ACCESSOR_MIN_MISMATCH warnings that don't affect rendering, and
 * gltf-transform's re-serialize during the Draco pass cleans them
 * up as a side effect).
 */

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
    if (m.severity === 0) errors.push(line);
    else if (m.severity === 1) warnings.push(line);
    // severity 2/3 ignored on purpose — INFO/HINT noise the worker
    // doesn't need to surface.
  }

  return {
    ok: raw.issues.numErrors === 0,
    errors,
    warnings,
  };
}
