// No `import "server-only"` — this module is also imported by smoke
// scripts in scripts/ (run via tsx, not Next), and server-only would
// fault those at import time. Consistent with src/lib/meshy.ts which
// also runs in both Next and script contexts. The DB-write side of
// this helper requires the service-role key, which is only set in
// trusted runtimes anyway, so accidental client-bundle inclusion
// would fail at runtime even without the marker.
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  createMeshyTask,
  isMeshyConfigured,
  MeshyApiError,
  MeshyNotConfiguredError,
} from "@/lib/meshy";
import { QuotaExceededError } from "@/lib/api-usage";

/**
 * Phase A · Milestone 3 · Commit 1 — kick off Meshy from a Publish.
 *
 * The "held-back-status" pattern that anchors the M3 publish flow:
 *
 *   Operator clicks Publish → action saves the row at status='draft'
 *   (NOT 'published'), then this helper POSTs to Meshy. The polling
 *   worker (Commit 5) flips the row to status='published' only after
 *   it pulls the GLB down. End state for the operator is:
 *
 *     - Without GLB        : status='draft', meshy_status='generating'
 *                            (UI shows "3D 生成中" banner)
 *     - With GLB (success) : status='published', meshy_status='succeeded'
 *     - With error         : status='draft', meshy_status='failed'
 *                            (UI shows "重新生成" button)
 *
 * Why this lives in its own file (not inside meshy.ts):
 *   meshy.ts is a pure API client — no DB, no Storage, no business
 *   rules. This file owns the rules that decide WHEN we're allowed
 *   to call createMeshyTask, and writes the resulting task_id /
 *   status into the products row. Keeping the API client pure means
 *   tests / scripts that just want to call Meshy don't drag in the
 *   whole DB layer.
 *
 * Why no retry logic here:
 *   "Meshy only runs once on first Publish" (Phase A 设计 §流程 B).
 *   Re-running is the polling worker's job (after FAILED, up to 3
 *   attempts) or the operator's job (manual "Retry Meshy" button).
 *   This helper is one-shot.
 *
 * Image source rule:
 *   Meshy needs PUBLIC URLs (its servers fetch them; our private
 *   `raw-images` bucket is unreachable). We use cutout_approved rows
 *   from `product_images` — those live in the public `cutouts`
 *   bucket and already have backgrounds removed (cleaner reconstruction
 *   for Meshy than raw photos with shadows + walls).
 *
 * The 1-4 image cap is Meshy's. We surface it as the no_cutouts /
 * too_many_cutouts errors; the action layer maps them to redirect
 * messages so the operator sees what to fix.
 */

export type KickOffOk = {
  ok: true;
  taskId: string;
  costUsd: number;
  imageCount: number;
};

export type KickOffErr = {
  ok: false;
  error: KickOffErrorCode;
  /** Optional human-readable detail for the redirect query string. */
  detail?: string;
};

export type KickOffErrorCode =
  // Pre-flight guards (no Meshy call attempted)
  | "product_missing"
  | "already_has_glb" // products.glb_url is set — manual upload or prior success
  | "already_in_flight" // meshy_status='generating' already
  | "no_cutouts" // 0 cutout_approved images
  | "too_many_cutouts" // > 4 cutout_approved images
  | "meshy_not_configured" // MESHY_API_KEY missing
  // Meshy / quota failures
  | "quota_exceeded"
  | "meshy_api_error"
  | "db_error"
  | "unknown";

export type KickOffResult = KickOffOk | KickOffErr;

/**
 * Kick off a Meshy multi-image-to-3D task for `productId`.
 *
 * Pre-conditions checked here (in order):
 *   1. product row exists
 *   2. product has no glb_url (Meshy never overwrites a manual upload)
 *   3. product is not already meshy_status='generating' (no double-fire)
 *   4. product has 1-4 cutout_approved images
 *   5. MESHY_API_KEY is configured
 *
 * On success:
 *   - api_usage row inserted (billed; createMeshyTask does this).
 *   - products row updated:
 *       meshy_task_id    = <Meshy task id>
 *       meshy_status     = 'generating'
 *       meshy_attempts   = 0   (fresh run — counter reset)
 *       meshy_error      = null
 *
 * On Meshy-side failure (4xx/5xx):
 *   - api_usage refunded by createMeshyTask.
 *   - products row updated:
 *       meshy_status     = 'failed'
 *       meshy_error      = <truncated reason>
 *       meshy_attempts   = 0
 *     (operator sees the Retry button — Commit 3.)
 */
export async function kickOffMeshyForProduct(
  productId: string,
): Promise<KickOffResult> {
  const supabase = createServiceRoleClient();

  // ── 1. Load product + image set in two cheap queries ─────────
  // Could be a single RPC, but two selects keep this readable
  // and the load is negligible (one row + at most a few image rows).
  const { data: product, error: productErr } = await supabase
    .from("products")
    .select("id, glb_url, meshy_status, meshy_task_id")
    .eq("id", productId)
    .maybeSingle();

  if (productErr) {
    return { ok: false, error: "db_error", detail: productErr.message };
  }
  if (!product) {
    return { ok: false, error: "product_missing" };
  }

  // ── 2. "Meshy only runs once" — refuse if a GLB already exists ──
  if (product.glb_url) {
    return { ok: false, error: "already_has_glb" };
  }

  // ── 3. No double-fire if a task is already in flight ─────────
  if (product.meshy_status === "generating") {
    return { ok: false, error: "already_in_flight" };
  }

  // ── 4. Gather public cutout URLs ─────────────────────────────
  // We pull cutout_image_url, not raw_image_url. Cutouts live in
  // the PUBLIC cutouts bucket (Meshy's fetcher needs public URLs);
  // raws live in a private bucket and would require signed URLs
  // that expire before Meshy finishes its 2-3 minute job.
  const { data: images, error: imagesErr } = await supabase
    .from("product_images")
    .select("id, cutout_image_url, sort_order")
    .eq("product_id", productId)
    .eq("state", "cutout_approved")
    .order("sort_order", { ascending: true });

  if (imagesErr) {
    return { ok: false, error: "db_error", detail: imagesErr.message };
  }

  const urls: string[] = [];
  for (const img of images ?? []) {
    if (typeof img.cutout_image_url === "string" && img.cutout_image_url.length > 0) {
      urls.push(img.cutout_image_url);
    }
  }

  if (urls.length === 0) {
    return { ok: false, error: "no_cutouts" };
  }
  if (urls.length > 4) {
    // Meshy hard-caps at 4. Take the first 4 by sort_order rather
    // than fail outright — the operator's intent ("publish") is
    // clearer than "they uploaded a 5th photo we should reject".
    // Could change to hard-fail later; for Phase A, be forgiving.
    urls.length = 4;
  }

  // ── 5. Verify Meshy is configured before reserving a slot ────
  // createMeshyTask will throw MeshyNotConfiguredError, but
  // checking here means we don't mutate the row first.
  if (!isMeshyConfigured()) {
    return { ok: false, error: "meshy_not_configured" };
  }

  // ── 6. Submit to Meshy. createMeshyTask reserves + bills the
  //      api_usage slot internally (refunds on POST failure).
  let taskId: string;
  let costUsd: number;
  try {
    const res = await createMeshyTask({ imageUrls: urls, productId });
    taskId = res.taskId;
    costUsd = res.costUsd;
  } catch (err) {
    // Map known errors to typed codes; anything else falls through
    // to 'unknown'. We also stamp meshy_status='failed' so the
    // admin UI surfaces the error + a Retry button immediately.
    let code: KickOffErrorCode = "unknown";
    const detail = err instanceof Error ? err.message : String(err);
    if (err instanceof QuotaExceededError) code = "quota_exceeded";
    else if (err instanceof MeshyApiError) code = "meshy_api_error";
    else if (err instanceof MeshyNotConfiguredError) code = "meshy_not_configured";

    // Best-effort failure stamp. If this update itself errors out,
    // we'd rather surface the original Meshy failure than mask it.
    await supabase
      .from("products")
      .update({
        meshy_status: "failed",
        meshy_error: detail.slice(0, 500),
        meshy_attempts: 0,
        meshy_task_id: null,
      })
      .eq("id", productId);

    return { ok: false, error: code, detail };
  }

  // ── 7. Stamp the row 'generating' so the polling worker (Commit
  //      5) and the UI banner (Commit 2) pick it up.
  const { error: updateErr } = await supabase
    .from("products")
    .update({
      meshy_task_id: taskId,
      meshy_status: "generating",
      meshy_attempts: 0,
      meshy_error: null,
    })
    .eq("id", productId);

  if (updateErr) {
    // Edge case: Meshy accepted the task (we paid the slot) but our
    // own DB write failed. Surface as db_error — operator can retry
    // the Publish; the polling worker won't see this orphan because
    // it filters on meshy_status='generating' which is still NULL.
    // Acceptable trade-off (rare) vs. the complexity of a transactional
    // outbox; logged so we can spot it in observability.
    console.error(
      `[meshy-kickoff] Meshy taskId=${taskId} created for product=${productId} but DB update failed: ${updateErr.message}`,
    );
    return { ok: false, error: "db_error", detail: updateErr.message };
  }

  return { ok: true, taskId, costUsd, imageCount: urls.length };
}
