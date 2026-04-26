// No `import "server-only"` — same reason as meshy-kickoff.ts: this
// module is also imported by smoke scripts in scripts/ that run via
// tsx (no Next runtime, no cookies). Service-role key is the actual
// gate; accidental client-bundle inclusion would fail at runtime
// without it anyway.
import { createServiceRoleClient } from "@/lib/supabase/service";
import { kickOffMeshyForProduct } from "@/lib/meshy-kickoff";

/**
 * Phase A · Milestone 3 · Commit 3 — operator-driven Meshy retry,
 * stripped of Next-runtime concerns so smoke scripts can exercise it.
 *
 * The matching server action (retryMeshyForProduct in
 * src/app/admin/(dashboard)/products/actions.ts) layers on:
 *   - requireAdmin() cookie gate
 *   - UUID_RE validation of productId
 *   - revalidatePath() of the edit page
 * …and otherwise just calls into here. Same split as
 * kickOffMeshyForProduct vs. updateProduct from Commit 1: the core
 * stays testable, the action stays thin.
 *
 * Gate enforced here (defense in depth — the Retry button also
 * gates client-side):
 *
 *   products.status        = 'draft'
 *   products.meshy_status  = 'failed'
 *   products.glb_url       = null
 *
 * Why all three? "Meshy only runs once on first Publish" is the
 * iron rule. published rows have cleared the publish gate (they
 * have a GLB, manual or worker-supplied). A status='published' +
 * meshy_status='failed' row is possible if the operator manually
 * uploaded a GLB after a Meshy failure — the row is live, no
 * re-run allowed. Likewise a draft+failed row with a glb_url
 * shouldn't retry (kickOff would refuse with already_has_glb
 * anyway, but we surface a clearer code here).
 *
 * On allowed retry:
 *   1. Reset row to meshy_status='pending', meshy_attempts=0,
 *      meshy_error=null, meshy_task_id=null. The 'pending'
 *      sentinel makes the banner flip from red→blue immediately
 *      (it treats pending the same as generating).
 *   2. Call kickOffMeshyForProduct, which re-validates the cutout
 *      image set + hits Meshy createTask + on success stamps
 *      meshy_status='generating' + meshy_task_id.
 *   3. On kickOff pre-flight failure (no_cutouts etc.), stamp
 *      back to meshy_status='failed' so the banner doesn't lie
 *      about a non-existent in-flight job. (kickOff itself only
 *      stamps 'failed' on Meshy 4xx/5xx, not on its own
 *      pre-flight refusals.)
 */

export type RetryErrorCode =
  | "product_missing"
  | "already_has_glb"
  | "wrong_status" // status !== 'draft'
  | "wrong_meshy_status" // meshy_status !== 'failed'
  | "db_error"
  // Forwarded from kickOffMeshyForProduct on its own refusals:
  | "no_cutouts"
  | "too_many_cutouts"
  | "meshy_not_configured"
  | "already_in_flight"
  | "quota_exceeded"
  | "meshy_api_error"
  | "unknown";

export type RetryResult =
  | { ok: true; taskId: string }
  | { ok: false; error: string; code: RetryErrorCode };

export async function retryMeshyForProductCore(
  productId: string,
): Promise<RetryResult> {
  const supabase = createServiceRoleClient();

  // ── 1. Re-verify gate. UI may be stale (another tab acted on
  //    the row, operator hand-edited via SQL, etc.).
  const { data: row, error: readErr } = await supabase
    .from("products")
    .select("status, meshy_status, glb_url")
    .eq("id", productId)
    .maybeSingle();

  if (readErr) return { ok: false, error: readErr.message, code: "db_error" };
  if (!row) return { ok: false, error: "product not found", code: "product_missing" };
  if (row.glb_url) {
    return {
      ok: false,
      error: "product already has a GLB",
      code: "already_has_glb",
    };
  }
  if (row.status !== "draft") {
    return {
      ok: false,
      error: `product is ${row.status}, retry only allowed on draft`,
      code: "wrong_status",
    };
  }
  if (row.meshy_status !== "failed") {
    return {
      ok: false,
      error: `meshy_status is ${row.meshy_status ?? "null"}, retry only allowed on failed`,
      code: "wrong_meshy_status",
    };
  }

  // ── 2. Reset to clean pre-flight state.
  const { error: resetErr } = await supabase
    .from("products")
    .update({
      meshy_status: "pending",
      meshy_attempts: 0,
      meshy_error: null,
      meshy_task_id: null,
    })
    .eq("id", productId);

  if (resetErr) {
    return { ok: false, error: resetErr.message, code: "db_error" };
  }

  // ── 3. Kick off via the same path as the initial Publish.
  //    Any rule we add to kickOff (new image cap, new pre-flight
  //    guard, etc.) automatically applies to retries — no drift.
  const result = await kickOffMeshyForProduct(productId);

  if (!result.ok) {
    // kickOff stamps meshy_status='failed' itself on Meshy 4xx/5xx
    // but NOT on its own pre-flight refusals (no_cutouts etc.) —
    // those leave the row at our 'pending' from step 2, which
    // would lie. Fix it.
    const preflightCodes: ReadonlyArray<typeof result.error> = [
      "no_cutouts",
      "too_many_cutouts",
      "meshy_not_configured",
      "already_has_glb",
      "already_in_flight",
      "product_missing",
    ];
    if (preflightCodes.includes(result.error)) {
      await supabase
        .from("products")
        .update({
          meshy_status: "failed",
          meshy_error: `retry blocked: ${result.error}`,
        })
        .eq("id", productId);
    }
    return {
      ok: false,
      error: result.detail ?? result.error,
      code: result.error,
    };
  }

  return { ok: true, taskId: result.taskId };
}
