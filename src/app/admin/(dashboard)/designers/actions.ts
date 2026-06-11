"use server";

/**
 * Wave 10 — server actions for the designer + credit admin pages.
 *
 * Every export here calls `requireAdmin()` first. Server actions are
 * URL-addressable (Next.js mints a `_next/data/...` POST endpoint for
 * each one) so the admin gate must be re-enforced even for actions
 * only called from within /admin pages. Same pattern as the existing
 * actions.ts in /products.
 *
 * Wave 10 deliberately does NOT expose:
 *   • designer self-service actions (login, change password) — those
 *     wait for the designer-facing front-end in a later wave.
 *   • Stripe / webhook actions — Wave 10 is admin-paced manual.
 *
 * The `recordDownload` action is the bridge to the (still admin-only)
 * download surface. It writes credit + the download log row in two
 * steps; if the second write fails we leave a comment on the ledger
 * row instead of trying to refund automatically (Wave 10 has tiny
 * volume + admin reconciliation; auto-refund infrastructure isn't
 * worth the lines yet).
 */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  adminAdjust,
  spendForDownload,
} from "@/lib/credit";
import type {
  DesignerStatus,
  SubscriptionPlan,
  DownloadFileType,
} from "@/lib/supabase/types";
import {
  SUBSCRIPTION_PLAN_CATALOG,
} from "@/lib/supabase/types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─── createDesigner ────────────────────────────────────────────
//
// Form-action style: parses FormData and redirects to /admin/designers
// on success (matches the patterns the products list uses for new
// product). One designer row + one credit_balances row at 0; both
// inserts wrapped so the partial state on a balance-insert failure
// is visible at the next list refresh.

export async function createDesignerAction(fd: FormData): Promise<void> {
  await requireAdmin();

  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const name = String(fd.get("name") ?? "").trim();
  const whatsapp = String(fd.get("whatsapp") ?? "").trim();
  const adminNote = String(fd.get("admin_note") ?? "").trim();

  if (!EMAIL_RE.test(email)) {
    redirect(`/admin/designers/new?err=email&msg=${encodeURIComponent("invalid email")}`);
  }
  if (!name) {
    redirect(`/admin/designers/new?err=name&msg=${encodeURIComponent("name required")}`);
  }

  const supabase = createServiceRoleClient();

  const { data: row, error: insErr } = await supabase
    .from("designers")
    .insert({
      email,
      name,
      whatsapp: whatsapp || null,
      admin_note: adminNote || null,
    })
    .select("id")
    .single();
  if (insErr || !row) {
    const msg = insErr?.message ?? "insert returned no row";
    redirect(`/admin/designers/new?err=db&msg=${encodeURIComponent(msg)}`);
  }

  // Seed the 1:1 balance row. If this fails we still redirect to
  // the list; the detail page will show a clear "missing balance"
  // and the operator can re-create the designer (rare since both
  // inserts are tiny).
  const { error: balErr } = await supabase
    .from("credit_balances")
    .insert({ designer_id: row.id, credit_balance: 0 });
  if (balErr) {
    redirect(
      `/admin/designers/${row.id}?err=balance&msg=${encodeURIComponent(balErr.message)}`,
    );
  }

  revalidatePath("/admin/designers");
  redirect(`/admin/designers/${row.id}?created=1`);
}

// ─── adminAdjustCreditAction ──────────────────────────────────
//
// Form-action invoked from the Designer detail page's "Adjust credit"
// chip. Accepts a signed integer delta + a required note (so the
// ledger is always self-explanatory). Returns to the detail page
// either way so the operator sees the new balance / failure inline.

export async function adminAdjustCreditAction(fd: FormData): Promise<void> {
  await requireAdmin();

  const designerId = String(fd.get("designer_id") ?? "");
  const rawAmount = String(fd.get("amount") ?? "");
  const note = String(fd.get("admin_note") ?? "").trim();

  if (!UUID_RE.test(designerId)) {
    redirect(`/admin/designers?err=id&msg=${encodeURIComponent("invalid id")}`);
  }
  const amount = Number(rawAmount);
  if (!Number.isInteger(amount) || amount === 0) {
    redirect(
      `/admin/designers/${designerId}?err=amount&msg=${encodeURIComponent("amount must be a non-zero integer")}`,
    );
  }
  if (!note) {
    redirect(
      `/admin/designers/${designerId}?err=note&msg=${encodeURIComponent("note is required for adjustments")}`,
    );
  }

  const res = await adminAdjust({ designerId, amount, adminNote: note });
  if (!res.ok) {
    const msg = res.code === "insufficient_credit"
      ? `cannot subtract: balance is ${res.balance}`
      : "error" in res
        ? res.error
        : res.code;
    redirect(
      `/admin/designers/${designerId}?err=${res.code}&msg=${encodeURIComponent(msg)}`,
    );
  }

  revalidatePath(`/admin/designers/${designerId}`);
  revalidatePath("/admin/designers");
  redirect(`/admin/designers/${designerId}?adjusted=1`);
}

// ─── createSubscriptionAction ─────────────────────────────────
//
// Form-action from the Designer detail page. plan dropdown writes
// the plan key; monthly_credit + monthly_price_myr default from the
// catalog but the form can override (lets Jym hand-price an enterprise
// designer without adding a new plan SKU).

export async function createSubscriptionAction(fd: FormData): Promise<void> {
  await requireAdmin();

  const designerId = String(fd.get("designer_id") ?? "");
  const plan = String(fd.get("plan") ?? "") as SubscriptionPlan;
  const monthlyCreditRaw = String(fd.get("monthly_credit") ?? "");
  const monthlyPriceRaw = String(fd.get("monthly_price_myr") ?? "");
  const adminNote = String(fd.get("admin_note") ?? "").trim();

  if (!UUID_RE.test(designerId)) {
    redirect(`/admin/designers?err=id&msg=${encodeURIComponent("invalid id")}`);
  }
  const catalogEntry = SUBSCRIPTION_PLAN_CATALOG[plan];
  if (!catalogEntry) {
    redirect(
      `/admin/designers/${designerId}?err=plan&msg=${encodeURIComponent("invalid plan")}`,
    );
  }

  // Form lets the operator override the catalog defaults. Empty →
  // fall back to catalog.
  const monthlyCredit = monthlyCreditRaw
    ? Number.parseInt(monthlyCreditRaw, 10)
    : catalogEntry.monthly_credit;
  const monthlyPrice = monthlyPriceRaw
    ? Number.parseInt(monthlyPriceRaw, 10)
    : catalogEntry.monthly_price_myr;
  if (!Number.isInteger(monthlyCredit) || monthlyCredit <= 0) {
    redirect(
      `/admin/designers/${designerId}?err=credit&msg=${encodeURIComponent("monthly_credit must be a positive integer")}`,
    );
  }
  if (!Number.isInteger(monthlyPrice) || monthlyPrice <= 0) {
    redirect(
      `/admin/designers/${designerId}?err=price&msg=${encodeURIComponent("monthly_price_myr must be a positive integer (cents)")}`,
    );
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("subscriptions").insert({
    designer_id: designerId,
    plan,
    monthly_credit: monthlyCredit,
    monthly_price_myr: monthlyPrice,
    admin_note: adminNote || null,
  });
  if (error) {
    redirect(
      `/admin/designers/${designerId}?err=db&msg=${encodeURIComponent(error.message)}`,
    );
  }

  revalidatePath(`/admin/designers/${designerId}`);
  redirect(`/admin/designers/${designerId}?subscribed=1`);
}

// ─── grantSubscriptionCreditAction ────────────────────────────
//
// Admin manually fires the monthly credit grant for one subscription.
// Wave 10 is admin-paced; a future wave will run this on a cron.
// The subscription row's monthly_credit is the source of truth (it's
// snapshotted at sub-creation; later plan-pricing changes don't
// retroactively rewrite).

export async function grantSubscriptionCreditAction(
  fd: FormData,
): Promise<void> {
  await requireAdmin();

  const subscriptionId = String(fd.get("subscription_id") ?? "");
  if (!UUID_RE.test(subscriptionId)) {
    redirect(`/admin/designers?err=id&msg=${encodeURIComponent("invalid sub id")}`);
  }

  const supabase = createServiceRoleClient();
  const { data: sub, error: readErr } = await supabase
    .from("subscriptions")
    .select("designer_id, monthly_credit, status, plan")
    .eq("id", subscriptionId)
    .maybeSingle();
  if (readErr || !sub) {
    redirect(
      `/admin/designers?err=db&msg=${encodeURIComponent(readErr?.message ?? "subscription not found")}`,
    );
  }
  if (sub.status !== "active") {
    redirect(
      `/admin/designers/${sub.designer_id}?err=sub_status&msg=${encodeURIComponent(`subscription is ${sub.status}`)}`,
    );
  }

  const moveCredit = await import("@/lib/credit").then((m) => m.moveCredit);
  const res = await moveCredit({
    designerId: sub.designer_id,
    amount: sub.monthly_credit,
    type: "subscription_grant",
    description: `Monthly grant — ${sub.plan}`,
  });
  if (!res.ok) {
    const msg = "error" in res ? res.error : res.code;
    redirect(
      `/admin/designers/${sub.designer_id}?err=grant&msg=${encodeURIComponent(msg)}`,
    );
  }

  revalidatePath(`/admin/designers/${sub.designer_id}`);
  redirect(`/admin/designers/${sub.designer_id}?granted=1`);
}

// ─── recordDownload ───────────────────────────────────────────
//
// JSON-returning action (NOT form-action) — meant to be called from
// the future designer-facing front-end and from manual admin-tested
// flows. Does the credit move first, then writes the downloads row.
// Caller gets a structured outcome with the new balance + the
// download id (so a download URL can be associated with it for
// audit).

export type RecordDownloadResult =
  | {
      ok: true;
      balance: number;
      downloadId: string;
      transactionId: string;
    }
  | { ok: false; code: "insufficient_credit"; balance: number }
  | { ok: false; code: "no_designer" }
  | { ok: false; code: "no_artifact" }
  | { ok: false; code: "missing_cost" }
  | { ok: false; code: "db"; error: string };

/**
 * Wave 10 — form-action wrapper around `recordDownload`. The bare
 * `recordDownload` below returns JSON (built for the future
 * designer front-end); this wrapper lets an admin manually record a
 * download from the Designer detail page when an off-platform sale
 * happens (designer DMs Jym, pays via QR, Jym fires the download
 * row + credit spend).
 */
export async function recordDownloadAction(fd: FormData): Promise<void> {
  await requireAdmin();
  const designerId = String(fd.get("designer_id") ?? "");
  const productId = String(fd.get("product_id") ?? "").trim();
  const fileType = String(fd.get("file_type") ?? "") as DownloadFileType;
  const creditCostRaw = String(fd.get("credit_cost") ?? "");

  if (!UUID_RE.test(designerId)) {
    redirect(`/admin/designers?err=id&msg=${encodeURIComponent("invalid designer id")}`);
  }
  if (!UUID_RE.test(productId)) {
    redirect(
      `/admin/designers/${designerId}?err=product&msg=${encodeURIComponent("invalid product id")}`,
    );
  }
  if (fileType !== "fbx" && fileType !== "glb") {
    redirect(
      `/admin/designers/${designerId}?err=file_type&msg=${encodeURIComponent("file_type must be fbx or glb")}`,
    );
  }
  const creditCost = Number.parseInt(creditCostRaw, 10);
  if (!Number.isInteger(creditCost) || creditCost < 0) {
    redirect(
      `/admin/designers/${designerId}?err=cost&msg=${encodeURIComponent("credit_cost must be a non-negative integer")}`,
    );
  }

  const res = await recordDownload({
    designerId,
    productId,
    fileType,
    creditCost,
  });
  if (!res.ok) {
    const msg =
      res.code === "insufficient_credit"
        ? `insufficient credit (balance ${res.balance}, need ${creditCost})`
        : "error" in res
          ? res.error
          : res.code;
    redirect(
      `/admin/designers/${designerId}?err=${res.code}&msg=${encodeURIComponent(msg)}`,
    );
  }

  revalidatePath(`/admin/designers/${designerId}`);
  redirect(`/admin/designers/${designerId}?downloaded=1`);
}

export async function recordDownload(input: {
  designerId: string;
  productId?: string | null;
  bundleId?: string | null;
  fileType: DownloadFileType;
  /** Wave 10 — there's no product-level "fbx_credit_cost" column yet.
   *  Caller passes the cost the admin set when curating the artifact.
   *  Wave 11 may add fbx_credit_cost to products + bundles; for now
   *  the action stays explicit. */
  creditCost: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<RecordDownloadResult> {
  await requireAdmin();

  if (!UUID_RE.test(input.designerId)) {
    return { ok: false, code: "no_designer" };
  }
  if (!input.productId && !input.bundleId) {
    return { ok: false, code: "no_artifact" };
  }
  if (input.productId && input.bundleId) {
    // The CHECK constraint enforces XOR, but the action layer should
    // also reject obvious caller errors.
    return { ok: false, code: "no_artifact" };
  }
  if (
    !Number.isInteger(input.creditCost) ||
    input.creditCost < 0
  ) {
    return { ok: false, code: "missing_cost" };
  }

  // 1. Spend credit (negative amount on the ledger).
  const move = await spendForDownload({
    designerId: input.designerId,
    cost: input.creditCost,
    productId: input.productId,
    bundleId: input.bundleId,
    fileType: input.fileType,
  });
  if (!move.ok) {
    if (move.code === "insufficient_credit") {
      return {
        ok: false,
        code: "insufficient_credit",
        balance: move.balance,
      };
    }
    if (move.code === "no_designer") {
      return { ok: false, code: "no_designer" };
    }
    return { ok: false, code: "db", error: move.error };
  }

  // 2. Append the downloads row. If this fails we leave the credit
  //    spend in place — admin can refund manually via adminAdjust if
  //    they see the gap. Acceptable trade-off for Wave 10's volume.
  const supabase = createServiceRoleClient();
  const { data: dlRow, error: dlErr } = await supabase
    .from("downloads")
    .insert({
      designer_id: input.designerId,
      product_id: input.productId ?? null,
      bundle_id: input.bundleId ?? null,
      credit_cost: input.creditCost,
      file_type: input.fileType,
      ip_address: input.ipAddress ?? null,
      user_agent: input.userAgent ?? null,
    })
    .select("id")
    .single();
  if (dlErr || !dlRow) {
    return {
      ok: false,
      code: "db",
      error: `credit spent but downloads insert failed: ${dlErr?.message ?? "no row"}`,
    };
  }

  revalidatePath(`/admin/designers/${input.designerId}`);
  return {
    ok: true,
    balance: move.balance,
    downloadId: dlRow.id,
    transactionId: move.transactionId,
  };
}
