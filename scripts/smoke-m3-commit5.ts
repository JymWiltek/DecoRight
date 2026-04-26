/**
 * Phase A · Milestone 3 · Commit 5 smoke
 *
 * Exercises the polling worker's logic via the testable
 * `processOne` / `pollAllInFlight` core in
 * supabase/functions/poll-meshy/worker.ts. ALL dependencies are
 * mocked — no Meshy hit, no Storage write, no DB roundtrip — so
 * this smoke runs offline and burns zero cents.
 *
 * Why mock everything instead of integration-testing against
 * the live edge function:
 *
 *   1. Edge functions run in Deno; this script is `tsx` (Node).
 *      Importing index.ts here would fail on `npm:` specifiers
 *      and `Deno.env`. The worker.ts module is import-free, so
 *      it loads cleanly under Node and we test the same code
 *      path the edge runtime executes.
 *
 *   2. Mocking lets us assert on the EXACT side effects (which
 *      DB rows we'd write, which Storage paths we'd upload to)
 *      with byte-level precision. An integration test against
 *      the live API would only see the eventual DB state.
 *
 *   3. Phase A budget rule: "commit 1-5 用 mock, 不烧真 credit".
 *      Commit 6 is where the live cron + real Meshy enters
 *      the picture.
 *
 * Cases (each a fresh fixture row + a fresh mock dep set):
 *
 *   [1] SUCCEEDED happy path   → download + upload + mark
 *                                succeeded with promoted=true
 *   [2] SUCCEEDED but no GLB   → terminal failed, no download
 *   [3] SUCCEEDED bad magic    → terminal failed, no upload
 *   [4] SUCCEEDED + room trigger blocks promote
 *                              → succeeded but promoted=false,
 *                                partialErrorMsg captured
 *   [5] FAILED                  → marked failed with reason
 *   [6] CANCELED                → marked failed with "canceled"
 *   [7] PENDING                 → still_running, no writes
 *   [8] IN_PROGRESS             → still_running, no writes
 *   [9] fetchTask throws        → transient, no writes,
 *                                ok=false transient=true
 *   [10] downloadGlb throws     → transient, no DB write
 *   [11] uploadGlb throws       → transient, no DB write
 *   [12] markSucceeded throws   → transient (next tick retries)
 *   [13] pollAllInFlight scans 3 rows, mixed outcomes
 *   [14] pollAllInFlight: empty in-flight list → no work, no logs
 *   [15] pollAllInFlight: listInFlight throws → no-op tick
 *   [16] uploadGlb URL is the same string the worker passes to
 *        markSucceeded (path-correctness check)
 *
 * Run:
 *   npx tsx scripts/smoke-m3-commit5.ts
 */
import {
  pollAllInFlight,
  processOne,
  type InFlightRow,
  type MeshyTaskSnapshot,
  type WorkerDeps,
} from "../supabase/functions/poll-meshy/worker";

let pass = 0;
let fail = 0;

function assert(cond: boolean, label: string, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${detail ? `  — ${detail}` : ""}`);
  }
}

// ── A valid GLB starts with "glTF" (0x67 0x6c 0x54 0x46). We
//    don't need a fully-valid GLB for the magic-bytes check —
//    just the 4-byte prefix.
const VALID_GLB_BYTES = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00]);
const BAD_BYTES = new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c]); // '<html'

/**
 * Build a fresh deps object + a recorder for side-effect calls.
 * Each test should construct its own (so assertions don't leak).
 */
type RecordedCall =
  | { kind: "fetchTask"; taskId: string }
  | { kind: "downloadGlb"; url: string }
  | { kind: "uploadGlb"; productId: string; size: number }
  | { kind: "markSucceeded"; productId: string; glbUrl: string }
  | { kind: "markFailed"; productId: string; reason: string };

function makeDeps(opts: {
  inFlight?: InFlightRow[];
  fetchTask?: (taskId: string) => Promise<MeshyTaskSnapshot>;
  downloadGlb?: (url: string) => Promise<Uint8Array>;
  uploadGlb?: (productId: string, bytes: Uint8Array) => Promise<string>;
  markSucceeded?: (
    productId: string,
    glbUrl: string,
  ) => Promise<{ promoted: boolean; partialErrorMsg?: string }>;
  markFailed?: (productId: string, reason: string) => Promise<void>;
  listInFlightThrows?: Error;
}): { deps: WorkerDeps; calls: RecordedCall[]; logs: string[] } {
  const calls: RecordedCall[] = [];
  const logs: string[] = [];
  const deps: WorkerDeps = {
    listInFlight: async () => {
      if (opts.listInFlightThrows) throw opts.listInFlightThrows;
      return opts.inFlight ?? [];
    },
    fetchTask: async (taskId) => {
      calls.push({ kind: "fetchTask", taskId });
      if (!opts.fetchTask) throw new Error("test bug: fetchTask not stubbed");
      return opts.fetchTask(taskId);
    },
    downloadGlb: async (url) => {
      calls.push({ kind: "downloadGlb", url });
      if (!opts.downloadGlb) throw new Error("test bug: downloadGlb not stubbed");
      return opts.downloadGlb(url);
    },
    uploadGlb: async (productId, bytes) => {
      calls.push({ kind: "uploadGlb", productId, size: bytes.length });
      if (!opts.uploadGlb) throw new Error("test bug: uploadGlb not stubbed");
      return opts.uploadGlb(productId, bytes);
    },
    markSucceeded: async (productId, glbUrl) => {
      calls.push({ kind: "markSucceeded", productId, glbUrl });
      if (!opts.markSucceeded) throw new Error("test bug: markSucceeded not stubbed");
      return opts.markSucceeded(productId, glbUrl);
    },
    markFailed: async (productId, reason) => {
      calls.push({ kind: "markFailed", productId, reason });
      if (!opts.markFailed) throw new Error("test bug: markFailed not stubbed");
      return opts.markFailed(productId, reason);
    },
    log: (msg) => logs.push(msg),
  };
  return { deps, calls, logs };
}

const ROW_A: InFlightRow = {
  id: "00000003-0000-4000-8000-000000000201",
  meshyTaskId: "task-A",
  meshyAttempts: 0,
};

async function main() {
  console.log("\n=== Milestone 3 · Commit 5 smoke ===\n");

  // ── Case 1: SUCCEEDED happy path ────────────────────────────
  console.log("[1] SUCCEEDED happy path → download + upload + mark succeeded + promoted");
  {
    const { deps, calls } = makeDeps({
      fetchTask: async () => ({
        id: "task-A",
        status: "SUCCEEDED",
        glbUrl: "https://meshy-cdn.example.com/sig=abc/model.glb",
      }),
      downloadGlb: async () => VALID_GLB_BYTES,
      uploadGlb: async (pid) => `https://supabase.example.com/storage/v1/object/public/models/products/${pid}/model.glb?v=123`,
      markSucceeded: async () => ({ promoted: true }),
    });
    const out = await processOne(ROW_A, deps);
    assert(out.ok, "ok=true", out.ok ? undefined : out.error);
    assert(
      out.ok && out.outcome === "succeeded",
      "outcome = succeeded",
      out.ok ? out.outcome : undefined,
    );
    assert(
      out.ok && out.outcome === "succeeded" && out.promoted === true,
      "promoted = true",
    );
    assert(
      calls.some((c) => c.kind === "fetchTask"),
      "fetchTask called",
    );
    assert(
      calls.some((c) => c.kind === "downloadGlb"),
      "downloadGlb called",
    );
    assert(
      calls.some(
        (c) => c.kind === "uploadGlb" && c.productId === ROW_A.id && c.size === VALID_GLB_BYTES.length,
      ),
      "uploadGlb called with right product + bytes",
    );
    assert(
      calls.some((c) => c.kind === "markSucceeded" && c.productId === ROW_A.id),
      "markSucceeded called",
    );
    assert(
      !calls.some((c) => c.kind === "markFailed"),
      "markFailed NOT called",
    );
  }

  // ── Case 2: SUCCEEDED but no glb URL ────────────────────────
  console.log("\n[2] SUCCEEDED but no glb URL → terminal failed, no download attempted");
  {
    const { deps, calls } = makeDeps({
      fetchTask: async () => ({
        id: "task-A",
        status: "SUCCEEDED",
        // glbUrl intentionally undefined
      }),
      markFailed: async () => {},
    });
    const out = await processOne(ROW_A, deps);
    assert(out.ok && out.outcome === "failed", "outcome = failed");
    assert(
      out.ok && out.outcome === "failed" && out.reason.includes("missing"),
      "reason mentions missing glb",
      out.ok && out.outcome === "failed" ? out.reason : undefined,
    );
    assert(!calls.some((c) => c.kind === "downloadGlb"), "downloadGlb NOT called");
    assert(!calls.some((c) => c.kind === "uploadGlb"), "uploadGlb NOT called");
    assert(calls.some((c) => c.kind === "markFailed"), "markFailed called");
  }

  // ── Case 3: SUCCEEDED but bad magic bytes ───────────────────
  console.log("\n[3] SUCCEEDED + bad magic bytes → terminal failed, no upload");
  {
    const { deps, calls } = makeDeps({
      fetchTask: async () => ({
        id: "task-A",
        status: "SUCCEEDED",
        glbUrl: "https://meshy-cdn.example.com/sig=xyz/model.glb",
      }),
      downloadGlb: async () => BAD_BYTES,
      markFailed: async () => {},
    });
    const out = await processOne(ROW_A, deps);
    assert(out.ok && out.outcome === "failed", "outcome = failed");
    assert(
      out.ok && out.outcome === "failed" && out.reason.includes("magic"),
      "reason mentions magic bytes",
      out.ok && out.outcome === "failed" ? out.reason : undefined,
    );
    assert(calls.some((c) => c.kind === "downloadGlb"), "downloadGlb called");
    assert(!calls.some((c) => c.kind === "uploadGlb"), "uploadGlb NOT called");
    assert(calls.some((c) => c.kind === "markFailed"), "markFailed called with magic-bytes reason");
  }

  // ── Case 4: SUCCEEDED but room_slugs trigger blocks promote ──
  console.log("\n[4] SUCCEEDED + room trigger blocks promote → succeeded with promoted=false");
  {
    const { deps, calls } = makeDeps({
      fetchTask: async () => ({
        id: "task-A",
        status: "SUCCEEDED",
        glbUrl: "https://meshy-cdn.example.com/sig=q/model.glb",
      }),
      downloadGlb: async () => VALID_GLB_BYTES,
      uploadGlb: async () => "https://example.com/uploaded.glb?v=1",
      markSucceeded: async () => ({
        promoted: false,
        partialErrorMsg: "Published product must have at least one room_slug",
      }),
    });
    const out = await processOne(ROW_A, deps);
    assert(out.ok && out.outcome === "succeeded", "outcome = succeeded");
    assert(
      out.ok && out.outcome === "succeeded" && out.promoted === false,
      "promoted = false (kept at draft)",
    );
    assert(calls.some((c) => c.kind === "markSucceeded"), "markSucceeded called");
  }

  // ── Case 5: FAILED ──────────────────────────────────────────
  console.log("\n[5] FAILED → markFailed with Meshy's reason");
  {
    const { deps, calls } = makeDeps({
      fetchTask: async () => ({
        id: "task-A",
        status: "FAILED",
        errorMessage: "image quality too low to reconstruct",
      }),
      markFailed: async () => {},
    });
    const out = await processOne(ROW_A, deps);
    assert(out.ok && out.outcome === "failed", "outcome = failed");
    assert(
      out.ok && out.outcome === "failed" && out.reason.includes("image quality"),
      "reason forwarded from Meshy",
    );
    assert(
      calls.some((c) => c.kind === "markFailed" && c.reason.includes("image quality")),
      "markFailed called with Meshy reason",
    );
    assert(!calls.some((c) => c.kind === "downloadGlb"), "downloadGlb NOT called");
  }

  // ── Case 6: CANCELED ────────────────────────────────────────
  console.log("\n[6] CANCELED → markFailed with canonical reason");
  {
    const { deps, calls } = makeDeps({
      fetchTask: async () => ({ id: "task-A", status: "CANCELED" }),
      markFailed: async () => {},
    });
    const out = await processOne(ROW_A, deps);
    assert(out.ok && out.outcome === "failed", "outcome = failed");
    assert(
      out.ok && out.outcome === "failed" && out.reason.toLowerCase().includes("cancel"),
      "reason mentions cancel",
    );
    assert(
      calls.some((c) => c.kind === "markFailed" && c.reason.toLowerCase().includes("cancel")),
      "markFailed called with cancel reason",
    );
  }

  // ── Case 7: PENDING ─────────────────────────────────────────
  console.log("\n[7] PENDING → still_running, no DB writes");
  {
    const { deps, calls } = makeDeps({
      fetchTask: async () => ({ id: "task-A", status: "PENDING" }),
    });
    const out = await processOne(ROW_A, deps);
    assert(out.ok && out.outcome === "still_running", "outcome = still_running");
    assert(
      !calls.some((c) => c.kind === "markSucceeded" || c.kind === "markFailed"),
      "no DB writes",
    );
  }

  // ── Case 8: IN_PROGRESS ─────────────────────────────────────
  console.log("\n[8] IN_PROGRESS → still_running, no DB writes");
  {
    const { deps, calls } = makeDeps({
      fetchTask: async () => ({ id: "task-A", status: "IN_PROGRESS" }),
    });
    const out = await processOne(ROW_A, deps);
    assert(out.ok && out.outcome === "still_running", "outcome = still_running");
    assert(!calls.some((c) => c.kind === "markFailed"), "no markFailed");
  }

  // ── Case 9: fetchTask throws ────────────────────────────────
  console.log("\n[9] fetchTask throws → transient no-op (row left at 'generating')");
  {
    const { deps, calls } = makeDeps({
      fetchTask: async () => {
        throw new Error("ECONNRESET");
      },
    });
    const out = await processOne(ROW_A, deps);
    assert(!out.ok, "ok = false");
    assert(!out.ok && out.transient === true, "transient = true");
    assert(
      !calls.some((c) => c.kind === "markFailed" || c.kind === "markSucceeded"),
      "no DB writes (ghost-error prevention)",
    );
  }

  // ── Case 10: downloadGlb throws ─────────────────────────────
  console.log("\n[10] downloadGlb throws → transient, no DB write");
  {
    const { deps, calls } = makeDeps({
      fetchTask: async () => ({
        id: "task-A",
        status: "SUCCEEDED",
        glbUrl: "https://meshy-cdn.example.com/sig=q/model.glb",
      }),
      downloadGlb: async () => {
        throw new Error("CDN timeout");
      },
    });
    const out = await processOne(ROW_A, deps);
    assert(!out.ok, "ok = false");
    assert(!out.ok && out.transient === true, "transient = true");
    assert(!calls.some((c) => c.kind === "uploadGlb"), "uploadGlb NOT called");
    assert(!calls.some((c) => c.kind === "markFailed"), "markFailed NOT called");
  }

  // ── Case 11: uploadGlb throws ───────────────────────────────
  console.log("\n[11] uploadGlb throws → transient, no DB write");
  {
    const { deps, calls } = makeDeps({
      fetchTask: async () => ({
        id: "task-A",
        status: "SUCCEEDED",
        glbUrl: "https://meshy-cdn.example.com/sig=q/model.glb",
      }),
      downloadGlb: async () => VALID_GLB_BYTES,
      uploadGlb: async () => {
        throw new Error("Storage 503");
      },
    });
    const out = await processOne(ROW_A, deps);
    assert(!out.ok, "ok = false");
    assert(!out.ok && out.transient === true, "transient = true");
    assert(!calls.some((c) => c.kind === "markSucceeded"), "markSucceeded NOT called");
    assert(!calls.some((c) => c.kind === "markFailed"), "markFailed NOT called");
  }

  // ── Case 12: markSucceeded throws ───────────────────────────
  console.log("\n[12] markSucceeded throws → transient (next tick re-uploads + retries)");
  {
    const { deps } = makeDeps({
      fetchTask: async () => ({
        id: "task-A",
        status: "SUCCEEDED",
        glbUrl: "https://meshy-cdn.example.com/sig=q/model.glb",
      }),
      downloadGlb: async () => VALID_GLB_BYTES,
      uploadGlb: async () => "https://example.com/uploaded.glb?v=1",
      markSucceeded: async () => {
        throw new Error("DB connection lost");
      },
    });
    const out = await processOne(ROW_A, deps);
    assert(!out.ok, "ok = false");
    assert(!out.ok && out.transient === true, "transient = true");
  }

  // ── Case 13: pollAllInFlight scans 3 rows, mixed ────────────
  console.log("\n[13] pollAllInFlight: 3 rows, mixed outcomes");
  {
    const rows: InFlightRow[] = [
      { id: "00000003-0000-4000-8000-000000000301", meshyTaskId: "t-1", meshyAttempts: 0 },
      { id: "00000003-0000-4000-8000-000000000302", meshyTaskId: "t-2", meshyAttempts: 0 },
      { id: "00000003-0000-4000-8000-000000000303", meshyTaskId: "t-3", meshyAttempts: 1 },
    ];
    const { deps } = makeDeps({
      inFlight: rows,
      fetchTask: async (taskId) => {
        if (taskId === "t-1") {
          return {
            id: "t-1",
            status: "SUCCEEDED",
            glbUrl: "https://meshy-cdn.example.com/t-1.glb",
          };
        }
        if (taskId === "t-2") return { id: "t-2", status: "IN_PROGRESS" };
        if (taskId === "t-3") {
          return { id: "t-3", status: "FAILED", errorMessage: "geometry too sparse" };
        }
        throw new Error("unexpected taskId");
      },
      downloadGlb: async () => VALID_GLB_BYTES,
      uploadGlb: async (pid) => `https://example.com/${pid}.glb?v=1`,
      markSucceeded: async () => ({ promoted: true }),
      markFailed: async () => {},
    });
    const result = await pollAllInFlight(deps);
    assert(result.scanned === 3, "scanned = 3", String(result.scanned));
    assert(result.outcomes.length === 3, "3 outcomes returned");
    assert(
      result.outcomes[0].ok && result.outcomes[0].outcome === "succeeded",
      "row 1 = succeeded",
    );
    assert(
      result.outcomes[1].ok && result.outcomes[1].outcome === "still_running",
      "row 2 = still_running",
    );
    assert(
      result.outcomes[2].ok && result.outcomes[2].outcome === "failed",
      "row 3 = failed",
    );
  }

  // ── Case 14: empty in-flight list ───────────────────────────
  console.log("\n[14] pollAllInFlight: empty list → no work");
  {
    const { deps, calls } = makeDeps({ inFlight: [] });
    const result = await pollAllInFlight(deps);
    assert(result.scanned === 0, "scanned = 0");
    assert(result.outcomes.length === 0, "no outcomes");
    assert(calls.length === 0, "no fetch / DB calls");
  }

  // ── Case 15: listInFlight throws ────────────────────────────
  console.log("\n[15] pollAllInFlight: listInFlight throws → no-op tick");
  {
    const { deps } = makeDeps({
      listInFlightThrows: new Error("DB dead"),
    });
    const result = await pollAllInFlight(deps);
    assert(result.scanned === 0, "scanned = 0 (graceful)");
    assert(result.outcomes.length === 0, "no outcomes");
  }

  // ── Case 16: uploadGlb URL = markSucceeded URL (path correctness) ─
  console.log("\n[16] uploadGlb returned URL is the SAME string passed to markSucceeded");
  {
    const expectedUrl = `https://supabase.example.com/storage/v1/object/public/models/products/${ROW_A.id}/model.glb?v=999`;
    let observedSucceededUrl = "";
    const { deps } = makeDeps({
      fetchTask: async () => ({
        id: "task-A",
        status: "SUCCEEDED",
        glbUrl: "https://meshy-cdn.example.com/sig=q/model.glb",
      }),
      downloadGlb: async () => VALID_GLB_BYTES,
      uploadGlb: async () => expectedUrl,
      markSucceeded: async (_pid, glbUrl) => {
        observedSucceededUrl = glbUrl;
        return { promoted: true };
      },
    });
    await processOne(ROW_A, deps);
    assert(
      observedSucceededUrl === expectedUrl,
      "markSucceeded received the exact URL uploadGlb returned",
      `expected="${expectedUrl}" got="${observedSucceededUrl}"`,
    );
  }

  console.log(`\n=== smoke result: ${pass} pass / ${fail} fail ===\n`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("\n!! smoke crashed:", err);
  process.exit(1);
});
