"use server";

/**
 * Wave 10 — server actions for the bundles admin pages.
 *
 * Bundles are curated product packs (e.g. "Black bathroom series",
 * "Minimalist living room"). A designer spends `credit_cost` to
 * unlock every product in the bundle. Wave 10 admin can:
 *   • Create a bundle (slug + name + price)
 *   • Add/remove products from a bundle
 *   • Toggle publish status
 *
 * No designer-facing unlock action yet — that lands when the
 * designer front-end ships.
 */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service";
import type { BundleStatus } from "@/lib/supabase/types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// URL-safe slug: a-z, 0-9, hyphens only. Operator types arbitrary
// case + spaces; the action normalizes before insert.
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ─── createBundleAction ───────────────────────────────────────
//
// Form-action from /admin/bundles/new. Required: name + credit_cost.
// slug auto-derived from name if not supplied. Empty product list is
// fine — operator can add products from the bundle detail page.

export async function createBundleAction(fd: FormData): Promise<void> {
  await requireAdmin();

  const name = String(fd.get("name") ?? "").trim();
  const slugRaw = String(fd.get("slug") ?? "").trim();
  const description = String(fd.get("description") ?? "").trim();
  const creditCostRaw = String(fd.get("credit_cost") ?? "");
  const productIdsRaw = String(fd.get("product_ids") ?? "").trim();
  const coverImageUrl = String(fd.get("cover_image_url") ?? "").trim();

  if (!name) {
    redirect(`/admin/bundles/new?err=name&msg=${encodeURIComponent("name required")}`);
  }

  const slug = slugRaw ? slugify(slugRaw) : slugify(name);
  if (!SLUG_RE.test(slug)) {
    redirect(
      `/admin/bundles/new?err=slug&msg=${encodeURIComponent("slug must be a-z 0-9 hyphen-only")}`,
    );
  }

  const creditCost = Number.parseInt(creditCostRaw, 10);
  if (!Number.isInteger(creditCost) || creditCost < 0) {
    redirect(
      `/admin/bundles/new?err=cost&msg=${encodeURIComponent("credit_cost must be a non-negative integer")}`,
    );
  }

  const productIds = productIdsRaw
    ? productIdsRaw
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : [];
  for (const id of productIds) {
    if (!UUID_RE.test(id)) {
      redirect(
        `/admin/bundles/new?err=product&msg=${encodeURIComponent(`invalid product id: ${id}`)}`,
      );
    }
  }

  const supabase = createServiceRoleClient();
  const { data: bundleRow, error: bundleErr } = await supabase
    .from("bundles")
    .insert({
      name,
      slug,
      description: description || null,
      credit_cost: creditCost,
      cover_image_url: coverImageUrl || null,
    })
    .select("id")
    .single();
  if (bundleErr || !bundleRow) {
    redirect(
      `/admin/bundles/new?err=db&msg=${encodeURIComponent(bundleErr?.message ?? "bundle insert failed")}`,
    );
  }

  if (productIds.length > 0) {
    const rows = productIds.map((pid, i) => ({
      bundle_id: bundleRow.id,
      product_id: pid,
      sort_order: i,
    }));
    const { error: linkErr } = await supabase
      .from("bundle_products")
      .insert(rows);
    if (linkErr) {
      // Partial-state: bundle exists, products didn't attach. Take
      // the operator to the detail page with the error so they can
      // re-attempt the attach from there.
      redirect(
        `/admin/bundles/${bundleRow.id}?err=link&msg=${encodeURIComponent(linkErr.message)}`,
      );
    }
  }

  revalidatePath("/admin/bundles");
  redirect(`/admin/bundles/${bundleRow.id}?created=1`);
}

// ─── updateBundleStatusAction ─────────────────────────────────
//
// Flip draft ↔ published. Tiny single-column UPDATE; isolated action
// so the publish chip doesn't have to re-post the whole form.

export async function updateBundleStatusAction(fd: FormData): Promise<void> {
  await requireAdmin();

  const bundleId = String(fd.get("bundle_id") ?? "");
  const status = String(fd.get("status") ?? "") as BundleStatus;

  if (!UUID_RE.test(bundleId)) {
    redirect(`/admin/bundles?err=id&msg=${encodeURIComponent("invalid id")}`);
  }
  if (status !== "draft" && status !== "published") {
    redirect(
      `/admin/bundles/${bundleId}?err=status&msg=${encodeURIComponent("invalid status")}`,
    );
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("bundles")
    .update({ status })
    .eq("id", bundleId);
  if (error) {
    redirect(
      `/admin/bundles/${bundleId}?err=db&msg=${encodeURIComponent(error.message)}`,
    );
  }

  revalidatePath(`/admin/bundles/${bundleId}`);
  revalidatePath("/admin/bundles");
  redirect(`/admin/bundles/${bundleId}?status_updated=1`);
}

// ─── addBundleProductAction ───────────────────────────────────
//
// Append a product to a bundle's product list. Sort-order is computed
// from the current row count so each new addition lands at the end.

export async function addBundleProductAction(fd: FormData): Promise<void> {
  await requireAdmin();

  const bundleId = String(fd.get("bundle_id") ?? "");
  const productId = String(fd.get("product_id") ?? "").trim();

  if (!UUID_RE.test(bundleId)) {
    redirect(`/admin/bundles?err=id&msg=${encodeURIComponent("invalid bundle id")}`);
  }
  if (!UUID_RE.test(productId)) {
    redirect(
      `/admin/bundles/${bundleId}?err=product&msg=${encodeURIComponent("invalid product id")}`,
    );
  }

  const supabase = createServiceRoleClient();

  // Read the current max sort_order so the new row lands at the end.
  const { count, error: countErr } = await supabase
    .from("bundle_products")
    .select("*", { count: "exact", head: true })
    .eq("bundle_id", bundleId);
  if (countErr) {
    redirect(
      `/admin/bundles/${bundleId}?err=db&msg=${encodeURIComponent(countErr.message)}`,
    );
  }

  const { error: insErr } = await supabase.from("bundle_products").insert({
    bundle_id: bundleId,
    product_id: productId,
    sort_order: count ?? 0,
  });
  if (insErr) {
    redirect(
      `/admin/bundles/${bundleId}?err=db&msg=${encodeURIComponent(insErr.message)}`,
    );
  }

  revalidatePath(`/admin/bundles/${bundleId}`);
  redirect(`/admin/bundles/${bundleId}?product_added=1`);
}

// ─── removeBundleProductAction ────────────────────────────────

export async function removeBundleProductAction(fd: FormData): Promise<void> {
  await requireAdmin();

  const bundleId = String(fd.get("bundle_id") ?? "");
  const productId = String(fd.get("product_id") ?? "");

  if (!UUID_RE.test(bundleId) || !UUID_RE.test(productId)) {
    redirect(`/admin/bundles?err=id&msg=${encodeURIComponent("invalid id")}`);
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("bundle_products")
    .delete()
    .eq("bundle_id", bundleId)
    .eq("product_id", productId);
  if (error) {
    redirect(
      `/admin/bundles/${bundleId}?err=db&msg=${encodeURIComponent(error.message)}`,
    );
  }

  revalidatePath(`/admin/bundles/${bundleId}`);
  redirect(`/admin/bundles/${bundleId}?product_removed=1`);
}
