"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { processImage } from "../products/[id]/upload/actions";

/**
 * Read optional `returnTo` from the form. Used so the same action can
 * be driven from EITHER the /admin/cutouts queue (default) OR inline
 * from the product edit workbench — in which case the redirect flips
 * back to the edit page so the operator never loses their place.
 *
 * Safety: only same-origin admin paths are honored. Anything else
 * (including external URLs and paths outside /admin) falls back to
 * the default to prevent open-redirect abuse via a crafted form post.
 */
function safeReturnTo(fd: FormData): string | null {
  const v = fd.get("returnTo")?.toString();
  if (!v) return null;
  if (!v.startsWith("/admin/")) return null;
  return v;
}

/**
 * Append a query param to a path that may already have one.
 */
function withQuery(path: string, key: string, value: string): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}${key}=${encodeURIComponent(value)}`;
}

/**
 * Mark a cutout as approved. If no product_images row for this product
 * has is_primary=true yet, we also promote this one to primary — which
 * triggers sync_primary_thumbnail() on the DB side to copy the cutout
 * URL into products.thumbnail_url.
 */
export async function approveCutout(fd: FormData): Promise<void> {
  const imageId = fd.get("imageId")?.toString();
  const returnTo = safeReturnTo(fd);
  const errBase = returnTo ?? "/admin/cutouts";
  if (!imageId) redirect(withQuery(errBase, "err", "missing_id"));

  const supabase = createServiceRoleClient();

  const { data: img, error: readErr } = await supabase
    .from("product_images")
    .select("id,product_id,is_primary,state")
    .eq("id", imageId)
    .single();
  if (readErr || !img) redirect(withQuery(errBase, "err", "not_found"));
  if (img.state !== "cutout_pending") {
    redirect(
      withQuery(withQuery(errBase, "err", "wrong_state"), "msg", img.state),
    );
  }

  // Does this product already have an approved primary? If not, we
  // auto-promote this one. We check for an error explicitly because
  // treating a failed read as "no primary" would incorrectly promote
  // a second image — something the partial unique index catches, but
  // surfacing the underlying DB error is friendlier than a confusing
  // constraint violation.
  const { data: existingPrimary, error: primaryErr } = await supabase
    .from("product_images")
    .select("id")
    .eq("product_id", img.product_id)
    .eq("is_primary", true)
    .maybeSingle();
  if (primaryErr) {
    redirect(
      withQuery(withQuery(errBase, "err", "db"), "msg", primaryErr.message),
    );
  }

  const patch: { state: "cutout_approved"; is_primary?: boolean } = {
    state: "cutout_approved",
  };
  if (!existingPrimary) patch.is_primary = true;

  const { error: updErr } = await supabase
    .from("product_images")
    .update(patch)
    .eq("id", imageId);
  if (updErr) {
    redirect(
      withQuery(withQuery(errBase, "err", "db"), "msg", updErr.message),
    );
  }

  // Revalidate everywhere a thumbnail may show up. /admin and / are
  // public lists that read products.thumbnail_url; without these,
  // after an approval the catalog can keep rendering the pre-approval
  // snapshot — which was the most likely source of the "wrong
  // product's thumbnail" reports.
  revalidatePath("/admin/cutouts");
  revalidatePath("/admin");
  revalidatePath("/");
  revalidatePath(`/admin/products/${img.product_id}/upload`);
  revalidatePath(`/admin/products/${img.product_id}/edit`);
  revalidatePath(`/product/${img.product_id}`);
  redirect(withQuery(returnTo ?? "/admin/cutouts", "approved", "1"));
}

/**
 * Reject a cutout. The operator can optionally pass rerun="removebg"
 * to immediately re-run rembg through the premium provider on the
 * same raw image — no need to re-upload.
 */
export async function rejectCutout(fd: FormData): Promise<void> {
  const imageId = fd.get("imageId")?.toString();
  const returnTo = safeReturnTo(fd);
  const errBase = returnTo ?? "/admin/cutouts";
  if (!imageId) redirect(withQuery(errBase, "err", "missing_id"));

  const supabase = createServiceRoleClient();
  const { data: img, error: readErr } = await supabase
    .from("product_images")
    .select("id,product_id,state")
    .eq("id", imageId)
    .single();
  if (readErr || !img) redirect(withQuery(errBase, "err", "not_found"));
  if (img.state !== "cutout_pending") {
    redirect(
      withQuery(withQuery(errBase, "err", "wrong_state"), "msg", img.state),
    );
  }

  const rerun = fd.get("rerun")?.toString();
  if (rerun === "removebg") {
    // Flip back to "raw" so processImage has a clean row to work with,
    // then re-run on Remove.bg. The row's rembg_provider/cost is
    // overwritten to reflect the latest attempt — we keep the audit
    // trail in the api_usage table, not on the image row.
    const { error: resetErr } = await supabase
      .from("product_images")
      .update({
        state: "raw",
        cutout_image_url: null,
        rembg_provider: null,
        rembg_cost_usd: null,
      })
      .eq("id", imageId);
    if (resetErr) {
      redirect(
        withQuery(withQuery(errBase, "err", "db"), "msg", resetErr.message),
      );
    }
    await processImage(img.product_id, imageId, "removebg");
    // processImage redirects on its own path; if it returned, fall through.
    revalidatePath("/admin/cutouts");
    revalidatePath("/admin");
    revalidatePath("/");
    revalidatePath(`/admin/products/${img.product_id}/edit`);
    redirect(withQuery(returnTo ?? "/admin/cutouts", "reran", "removebg"));
  }

  const { error: updErr } = await supabase
    .from("product_images")
    .update({ state: "cutout_rejected" })
    .eq("id", imageId);
  if (updErr) {
    redirect(
      withQuery(withQuery(errBase, "err", "db"), "msg", updErr.message),
    );
  }

  revalidatePath("/admin/cutouts");
  revalidatePath(`/admin/products/${img.product_id}/upload`);
  revalidatePath(`/admin/products/${img.product_id}/edit`);
  redirect(withQuery(returnTo ?? "/admin/cutouts", "rejected", "1"));
}

/** Promote a non-primary approved image to primary. Triggers the
 *  thumbnail sync function on the DB side. */
export async function setPrimary(fd: FormData): Promise<void> {
  const imageId = fd.get("imageId")?.toString();
  const returnTo = safeReturnTo(fd);
  const errBase = returnTo ?? "/admin/cutouts";
  if (!imageId) redirect(withQuery(errBase, "err", "missing_id"));
  const supabase = createServiceRoleClient();

  const { data: img } = await supabase
    .from("product_images")
    .select("id,product_id,state")
    .eq("id", imageId)
    .single();
  if (!img) redirect(withQuery(errBase, "err", "not_found"));
  if (img.state !== "cutout_approved") {
    redirect(
      withQuery(withQuery(errBase, "err", "wrong_state"), "msg", img.state),
    );
  }

  // Partial unique index (is_primary=true) enforces one-per-product,
  // so we first clear any existing primary, then set the new one.
  await supabase
    .from("product_images")
    .update({ is_primary: false })
    .eq("product_id", img.product_id)
    .eq("is_primary", true);
  const { error: updErr } = await supabase
    .from("product_images")
    .update({ is_primary: true })
    .eq("id", imageId);
  if (updErr) {
    redirect(
      withQuery(withQuery(errBase, "err", "db"), "msg", updErr.message),
    );
  }

  revalidatePath("/admin/cutouts");
  revalidatePath("/admin");
  revalidatePath("/");
  revalidatePath(`/admin/products/${img.product_id}/upload`);
  revalidatePath(`/admin/products/${img.product_id}/edit`);
  revalidatePath(`/product/${img.product_id}`);
  redirect(withQuery(returnTo ?? "/admin/cutouts", "primary", "1"));
}
