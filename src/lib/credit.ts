import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/service";
import type {
  CreditTxnType,
  DownloadFileType,
} from "@/lib/supabase/types";

/**
 * Wave 10 — credit math for the paid-FBX-download skeleton.
 *
 * The runtime contract we want to preserve:
 *
 *   credit_balances.credit_balance ==
 *     SUM(credit_transactions.amount FOR designer_id)
 *
 * Wave 10 maintains this from the application layer (no DB trigger
 * yet — keeping it visible so the math is auditable, and so a future
 * wave can swap in a trigger without re-shaping the ledger). Every
 * helper here does the ledger write FIRST and the balance update
 * SECOND, in that order. If the second write fails the audit ledger
 * still reflects the intent; the next call can heal the balance by
 * re-summing. We don't expose a re-heal RPC yet because the ledger
 * is tiny in Wave 10 (admin-onboarded designers only) and the risk
 * of a torn write is tiny — Supabase REST writes either commit or
 * don't, no partial.
 *
 * Why NOT use a single transactional RPC: Wave 10's pace is
 * admin-paced (Jym types in numbers). Concurrency is effectively
 * one writer at a time. A custom RPC would add infrastructure
 * (define + apply + grant) without a real performance win — REST +
 * two writes is fine here and keeps the code path debuggable.
 *
 * The `INSUFFICIENT_CREDIT` sentinel result lets callers (server
 * actions) translate into a user-facing error WITHOUT a thrown
 * exception — the action layer can return `{ok:false, code:"…"}`
 * directly. Throws are reserved for genuinely unexpected DB errors.
 */

export type CreditMoveResult =
  | { ok: true; balance: number; transactionId: string }
  | { ok: false; code: "insufficient_credit"; balance: number }
  | { ok: false; code: "no_designer" }
  | { ok: false; code: "db"; error: string };

/**
 * Read the designer's current credit balance. Returns null if the
 * designer has no balance row yet (shouldn't happen — createDesigner
 * inserts a 0-balance row — but we don't want to bake that
 * assumption into reads). The admin list / detail pages use this.
 */
export async function getCreditBalance(
  designerId: string,
): Promise<number | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("credit_balances")
    .select("credit_balance")
    .eq("designer_id", designerId)
    .maybeSingle();
  if (error) throw error;
  return data?.credit_balance ?? null;
}

/**
 * Wave 10 — true when the designer has at least `cost` credit. Used
 * as a server-action-level gate before calling `spendCredit`. Returns
 * false if the designer doesn't exist; callers should already have
 * validated the id before getting here, but defending against this
 * is cheap.
 */
export async function hasEnoughCredit(
  designerId: string,
  cost: number,
): Promise<boolean> {
  const bal = await getCreditBalance(designerId);
  if (bal == null) return false;
  return bal >= cost;
}

/**
 * Core credit move primitive. Both top-ups and spends route through
 * here so the ledger ↔ balance pair stays consistent.
 *
 *   amount > 0 — purchase / refund / subscription_grant / admin_adjust+
 *   amount < 0 — download spend / admin_adjust−
 *
 * The CHECK constraint on credit_balances enforces non-negative, so
 * an over-spend gets caught at the DB layer. We surface a clean
 * `insufficient_credit` result instead of letting that error bubble.
 *
 * Caller-supplied fields (description, related_*, admin_note) are
 * passed straight through into the ledger row. They're used by the
 * admin Designer detail page to render "what was this credit move
 * for".
 */
export async function moveCredit(input: {
  designerId: string;
  amount: number;
  type: CreditTxnType;
  description?: string | null;
  relatedProductId?: string | null;
  relatedBundleId?: string | null;
  adminNote?: string | null;
}): Promise<CreditMoveResult> {
  if (!Number.isInteger(input.amount) || input.amount === 0) {
    return {
      ok: false,
      code: "db",
      error: "amount must be a non-zero integer",
    };
  }

  const supabase = createServiceRoleClient();

  // 1. Read current balance + verify designer exists.
  const { data: balRow, error: readErr } = await supabase
    .from("credit_balances")
    .select("credit_balance")
    .eq("designer_id", input.designerId)
    .maybeSingle();
  if (readErr) {
    return { ok: false, code: "db", error: readErr.message };
  }
  if (balRow == null) {
    return { ok: false, code: "no_designer" };
  }
  const currentBalance = balRow.credit_balance;
  const nextBalance = currentBalance + input.amount;
  if (nextBalance < 0) {
    return {
      ok: false,
      code: "insufficient_credit",
      balance: currentBalance,
    };
  }

  // 2. Append the ledger row FIRST. If the balance update below
  //    fails, the ledger still captures the intent — operators can
  //    spot the gap by `select sum(amount) from credit_transactions
  //    where designer_id = … ` and reconcile.
  const { data: txnRow, error: insErr } = await supabase
    .from("credit_transactions")
    .insert({
      designer_id: input.designerId,
      type: input.type,
      amount: input.amount,
      description: input.description ?? null,
      related_product_id: input.relatedProductId ?? null,
      related_bundle_id: input.relatedBundleId ?? null,
      admin_note: input.adminNote ?? null,
    })
    .select("id")
    .single();
  if (insErr || !txnRow) {
    return {
      ok: false,
      code: "db",
      error: insErr?.message ?? "ledger insert returned no row",
    };
  }

  // 3. Update the dense balance row. updated_at refreshes by hand
  //    since the column has no trigger.
  const { error: updErr } = await supabase
    .from("credit_balances")
    .update({
      credit_balance: nextBalance,
      updated_at: new Date().toISOString(),
    })
    .eq("designer_id", input.designerId);
  if (updErr) {
    return { ok: false, code: "db", error: updErr.message };
  }

  return { ok: true, balance: nextBalance, transactionId: txnRow.id };
}

/**
 * Convenience wrapper: admin-driven manual credit adjustment. Either
 * direction (add or remove). Logged as `admin_adjust` so the ledger
 * keeps purchases / spends / refunds separable in analytics.
 */
export function adminAdjust(input: {
  designerId: string;
  amount: number;
  adminNote: string;
}): Promise<CreditMoveResult> {
  return moveCredit({
    designerId: input.designerId,
    amount: input.amount,
    type: "admin_adjust",
    description: input.adminNote,
    adminNote: input.adminNote,
  });
}

/**
 * Convenience wrapper: paid download. Spends a positive `cost` as a
 * negative amount on the ledger, ties the row back to the artifact
 * (product OR bundle) the designer paid for. `fileType` mirrors the
 * downloads.file_type column ('fbx' or 'glb') so the per-artifact
 * download log + the ledger agree on what was sold.
 *
 * NOTE: this only writes the credit side. The caller (server action)
 * is responsible for writing the `downloads` row + signing the
 * Supabase Storage download URL. Order in the caller:
 *
 *   1. moveCredit({ amount: -cost, type: 'download', related_…: id })
 *   2. If ok, INSERT downloads (designer_id, product_id, bundle_id, …)
 *   3. Return signed Storage URL
 *
 * If step 2 fails we'd ideally roll back step 1 with a `refund`
 * row. Wave 10 just logs the gap — the volume is admin-paced for
 * months and reconciliation is cheap.
 */
export function spendForDownload(input: {
  designerId: string;
  cost: number;
  productId?: string | null;
  bundleId?: string | null;
  // file_type is part of downloads — included here for the ledger
  // description so a future admin Q can answer "how much credit did
  // designer X spend on FBX vs GLB last month".
  fileType: DownloadFileType;
}): Promise<CreditMoveResult> {
  if (input.cost < 0) {
    return Promise.resolve({
      ok: false,
      code: "db",
      error: "cost must be non-negative",
    });
  }
  return moveCredit({
    designerId: input.designerId,
    amount: -input.cost,
    type: "download",
    description: `${input.fileType.toUpperCase()} download`,
    relatedProductId: input.productId ?? null,
    relatedBundleId: input.bundleId ?? null,
  });
}
