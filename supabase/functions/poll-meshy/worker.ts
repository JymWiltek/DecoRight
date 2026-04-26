/**
 * Phase A · Milestone 3 · Commit 5 — pure worker logic.
 *
 * Deliberately ZERO imports. Every external dependency (DB calls,
 * Meshy fetches, Storage uploads, the clock) comes in via the
 * `WorkerDeps` argument. This is what makes the worker testable
 * from a Node `tsx` smoke (which can't load Deno-only / `npm:`
 * specifiers from index.ts) and runnable from Deno Deploy
 * (which can't load Node-only `@/lib/...` aliases).
 *
 * Same architectural pattern as kickOffMeshyForProduct vs. the
 * updateProduct action, and retryMeshyForProductCore vs. the
 * retryMeshyForProduct action: testable core, thin runtime
 * shell (index.ts) on top.
 *
 * Worker contract (one tick of the cron job):
 *
 *   1. List every product with meshy_status='generating' AND a
 *      non-null meshy_task_id. ('pending' rows haven't been
 *      submitted to Meshy yet — there's nothing to poll. Failed/
 *      succeeded rows are terminal — also nothing to poll.)
 *
 *   2. For each row:
 *        a. GET task status from Meshy (free, doesn't bill).
 *        b. Branch on Meshy's status:
 *
 *           SUCCEEDED  → download GLB from Meshy's signed URL,
 *                        validate magic bytes, upload to our
 *                        `models` bucket at the canonical path,
 *                        UPDATE products SET meshy_status='succeeded',
 *                        glb_url=<our public URL>, glb_generated_at,
 *                        glb_source='meshy', meshy_error=null,
 *                        status='published' (the held-back-status
 *                        promotion from Commit 1's design).
 *
 *           FAILED     → UPDATE products SET meshy_status='failed',
 *                        meshy_error=<Meshy's reason>. The row
 *                        sits at status='draft' (held back), and
 *                        the operator gets the red banner with the
 *                        Retry button (Commit 3) to recover.
 *
 *           CANCELED   → treated as FAILED with reason "canceled".
 *                        Phase A doesn't expose a cancel UI yet,
 *                        so this only happens if someone cancels
 *                        the task in Meshy's dashboard.
 *
 *           PENDING    → no-op; the next tick polls again.
 *           IN_PROGRESS → no-op; the next tick polls again.
 *
 *        c. Transient failure (Meshy GET 5xx, Storage timeout,
 *           network blip): no DB write, leave the row at
 *           'generating'. Next tick retries naturally. We
 *           explicitly do NOT mark the row 'failed' on transients
 *           — that would make the operator chase ghosts.
 *
 * Why no auto-retry on Meshy FAILED:
 *   The kick-off helper (Commit 1) and retry core (Commit 3) both
 *   reset meshy_attempts=0. The operator-driven Retry button is
 *   the recovery path. Auto-retrying inside the worker would burn
 *   $0.25 silently every time Meshy hiccups — unacceptable for
 *   Phase A's small budget. The meshy_attempts column is reserved
 *   for a future "auto-retry up to N times" toggle if we want it.
 *
 * Why we promote draft → published in the worker, not at click time:
 *   Commit 1's "held-back-status" pattern saves the row at draft
 *   when Publish is clicked on a GLB-less product. Without that,
 *   "没 GLB 不上线" (no GLB no publishing) would require either a
 *   blocking wait for Meshy (2-3 minutes!) or letting GLB-less
 *   rows go live. The worker is the async half of that
 *   pattern: it watches for the GLB to land, then promotes.
 *
 * Idempotency:
 *   - GET is naturally idempotent.
 *   - Download + upload: if a tick is interrupted mid-upload, the
 *     next tick re-downloads (Meshy URLs are valid for ~1h) and
 *     re-uploads (Storage upsert at canonical path). No corruption.
 *   - The DB UPDATE is idempotent on its own fields.
 *   - Two simultaneous workers processing the same row would
 *     double-download. Phase A runs one cron tick at a time
 *     (pg_cron is single-threaded per DB), so this can't happen
 *     in practice.
 *
 * Concurrency within a tick:
 *   We process rows sequentially, not in parallel. Phase A targets
 *   ~10 in-flight tasks max — sequential keeps the worker simple
 *   and avoids hitting Meshy's rate limit if N rows were all
 *   ready at once. If the in-flight count grows past ~50, switch
 *   to Promise.all with a small concurrency cap.
 */

// ── shared types — duplicated (not imported) from src/lib/meshy.ts
//    so this file stays import-free. The two definitions must
//    agree; if Meshy's status enum drifts, update both.
export type MeshyTaskStatus =
  | "PENDING"
  | "IN_PROGRESS"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELED";

export type MeshyTaskSnapshot = {
  id: string;
  status: MeshyTaskStatus;
  /** Only populated when status='SUCCEEDED'. */
  glbUrl?: string;
  /** Only populated when status='FAILED'/'CANCELED'. */
  errorMessage?: string;
};

/** A row from `products` that the worker considers in-flight. */
export type InFlightRow = {
  id: string;
  meshyTaskId: string;
  meshyAttempts: number;
};

/** Outcome reported by processOne — useful for logging + the smoke. */
export type ProcessOutcome =
  | { ok: true; productId: string; outcome: "succeeded"; promoted: boolean }
  | { ok: true; productId: string; outcome: "failed"; reason: string }
  | { ok: true; productId: string; outcome: "still_running"; status: MeshyTaskStatus }
  | { ok: false; productId: string; error: string; transient: boolean };

/**
 * Everything the worker needs from the outside world. The Deno
 * index.ts wires real implementations (Supabase client + native
 * fetch); the Node smoke wires mocks.
 */
export type WorkerDeps = {
  /** Read all rows the worker should poll this tick. */
  listInFlight: () => Promise<InFlightRow[]>;

  /** GET Meshy task status. Returns normalized snapshot. Throws on
   *  network / 5xx for transient failures (worker treats as no-op). */
  fetchTask: (taskId: string) => Promise<MeshyTaskSnapshot>;

  /** Download GLB bytes from Meshy's short-lived signed URL.
   *  Returns the raw bytes. Throws on transient failures. */
  downloadGlb: (url: string) => Promise<Uint8Array>;

  /** Upload bytes to our Storage `models` bucket at the canonical
   *  path. Returns the public URL (with cache-bust). */
  uploadGlb: (productId: string, bytes: Uint8Array) => Promise<string>;

  /** Stamp the row meshy_status='succeeded' + glb fields, and
   *  attempt to promote status='draft' → 'published'. Returns
   *  whether the promotion landed. */
  markSucceeded: (
    productId: string,
    glbUrl: string,
  ) => Promise<{ promoted: boolean; partialErrorMsg?: string }>;

  /** Stamp the row meshy_status='failed' + meshy_error. */
  markFailed: (productId: string, reason: string) => Promise<void>;

  /** Optional logger — defaults to console.log if not provided. */
  log?: (msg: string) => void;
};

/** GLB magic bytes: 'glTF' (0x67 0x6c 0x54 0x46). */
function isValidGlbMagic(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x67 &&
    bytes[1] === 0x6c &&
    bytes[2] === 0x54 &&
    bytes[3] === 0x46
  );
}

/**
 * Process a single in-flight row. Returns a structured outcome —
 * never throws (transient failures are caught and reported as
 * { ok: false, transient: true }).
 */
export async function processOne(
  row: InFlightRow,
  deps: WorkerDeps,
): Promise<ProcessOutcome> {
  const log = deps.log ?? ((m: string) => console.log(m));

  // ── 1. Poll Meshy. Network/5xx errors → transient no-op. ──
  let task: MeshyTaskSnapshot;
  try {
    task = await deps.fetchTask(row.meshyTaskId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`[poll-meshy] product=${row.id} task=${row.meshyTaskId} fetchTask error: ${msg}`);
    return { ok: false, productId: row.id, error: msg, transient: true };
  }

  // ── 2. Branch on Meshy status ─────────────────────────────
  if (task.status === "PENDING" || task.status === "IN_PROGRESS") {
    return { ok: true, productId: row.id, outcome: "still_running", status: task.status };
  }

  if (task.status === "FAILED" || task.status === "CANCELED") {
    const reason =
      task.errorMessage ??
      (task.status === "CANCELED" ? "Meshy task canceled" : "Meshy task failed");
    try {
      await deps.markFailed(row.id, reason.slice(0, 500));
      log(`[poll-meshy] product=${row.id} → failed: ${reason.slice(0, 120)}`);
      return { ok: true, productId: row.id, outcome: "failed", reason };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`[poll-meshy] product=${row.id} markFailed DB write failed: ${msg}`);
      return { ok: false, productId: row.id, error: msg, transient: true };
    }
  }

  // status === 'SUCCEEDED' from here on.
  if (!task.glbUrl) {
    // Meshy claims SUCCEEDED but didn't give us a GLB URL. This
    // shouldn't happen in practice — but if it does, it's terminal:
    // the task is done and there's nothing to download. Stamp
    // failed so the operator can retry rather than spin forever.
    const reason = "Meshy reported SUCCEEDED but model_urls.glb was missing";
    try {
      await deps.markFailed(row.id, reason);
      return { ok: true, productId: row.id, outcome: "failed", reason };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, productId: row.id, error: msg, transient: true };
    }
  }

  // ── 3. Download GLB from Meshy's CDN (transient on failure) ──
  let bytes: Uint8Array;
  try {
    bytes = await deps.downloadGlb(task.glbUrl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`[poll-meshy] product=${row.id} downloadGlb error: ${msg}`);
    return { ok: false, productId: row.id, error: msg, transient: true };
  }

  // ── 4. Validate magic bytes. Bad bytes = TERMINAL (not transient):
  //      Meshy returned a 200 with non-GLB content (rare CDN-edge HTML
  //      error page), retrying won't help. Stamp failed.
  if (!isValidGlbMagic(bytes)) {
    const got = Array.from(bytes.slice(0, 4))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const reason = `Downloaded GLB has invalid magic bytes (expected 'glTF' / 67 6c 54 46, got ${got}; size=${bytes.length})`;
    try {
      await deps.markFailed(row.id, reason);
      return { ok: true, productId: row.id, outcome: "failed", reason };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, productId: row.id, error: msg, transient: true };
    }
  }

  // ── 5. Upload to our Storage. Transient on failure — next tick
  //      will re-download (Meshy URL still good for ~1h) + retry.
  let publicUrl: string;
  try {
    publicUrl = await deps.uploadGlb(row.id, bytes);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`[poll-meshy] product=${row.id} uploadGlb error: ${msg}`);
    return { ok: false, productId: row.id, error: msg, transient: true };
  }

  // ── 6. Stamp succeeded + promote to published. The deps layer
  //      attempts the full UPDATE first (status='published' included);
  //      if the room_slugs trigger fires (operator forgot to set
  //      rooms — should've been blocked at click time but defense in
  //      depth), it falls back to the partial update without status.
  try {
    const { promoted, partialErrorMsg } = await deps.markSucceeded(row.id, publicUrl);
    log(
      `[poll-meshy] product=${row.id} → succeeded${promoted ? " + published" : ` (kept draft: ${partialErrorMsg})`}`,
    );
    return { ok: true, productId: row.id, outcome: "succeeded", promoted };
  } catch (err) {
    // Both the full and partial UPDATE failed. The GLB is uploaded
    // (we paid the bandwidth) but the row is unchanged. Next tick
    // will see status='generating' still, re-download, re-upload
    // (idempotent), and retry the UPDATE.
    const msg = err instanceof Error ? err.message : String(err);
    log(`[poll-meshy] product=${row.id} markSucceeded DB write failed: ${msg}`);
    return { ok: false, productId: row.id, error: msg, transient: true };
  }
}

/**
 * Process every in-flight row. Sequential — Phase A targets ~10
 * tasks max per tick, and parallel adds Meshy-rate-limit risk for
 * minimal gain. Returns the per-row outcomes in input order.
 *
 * If listInFlight itself throws, the whole tick is a no-op and
 * pg_cron will fire again next minute. Logged so we can spot it.
 */
export async function pollAllInFlight(
  deps: WorkerDeps,
): Promise<{
  scanned: number;
  outcomes: ProcessOutcome[];
}> {
  const log = deps.log ?? ((m: string) => console.log(m));

  let rows: InFlightRow[];
  try {
    rows = await deps.listInFlight();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`[poll-meshy] listInFlight failed: ${msg}`);
    return { scanned: 0, outcomes: [] };
  }

  if (rows.length === 0) {
    // Quiet log — most ticks will hit zero in-flight rows.
    log(`[poll-meshy] tick: 0 in-flight tasks`);
    return { scanned: 0, outcomes: [] };
  }

  log(`[poll-meshy] tick: ${rows.length} in-flight task${rows.length === 1 ? "" : "s"}`);

  const outcomes: ProcessOutcome[] = [];
  for (const row of rows) {
    outcomes.push(await processOne(row, deps));
  }
  return { scanned: rows.length, outcomes };
}
