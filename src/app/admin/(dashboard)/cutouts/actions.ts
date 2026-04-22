"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { processImage } from "../products/[id]/upload/actions";

/**
 * Mark a cutout as approved. If no product_images row for this product
 * has is_primary=true yet, we also promote this one to primary — which
 * triggers sync_primary_thumbnail() on the DB side to copy the cutout
 * URL into products.thumbnail_url.
 */
export async function approveCutout(fd: FormData): Promise<void> {
  const imageId = fd.get("imageId")?.toString();
  if (!imageId) redirect("/admin/cutouts?err=missing_id");

  const supabase = createServiceRoleClient();

  const { data: img, error: readErr } = await supabase
    .from("product_images")
    .select("id,product_id,is_primary,state")
    .eq("id", imageId)
    .single();
  if (readErr || !img) redirect("/admin/cutouts?err=not_found");
  if (img.state !== "cutout_pending") {
    redirect(`/admin/cutouts?err=wrong_state&msg=${img.state}`);
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
      `/admin/cutouts?err=db&msg=${encodeURIComponent(primaryErr.message)}`,
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
      `/admin/cutouts?err=db&msg=${encodeURIComponent(updErr.message)}`,
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
  redirect("/admin/cutouts?approved=1");
}

/**
 * Reject a cutout. The operator can optionally pass rerun="removebg"
 * to immediately re-run rembg through the premium provider on the
 * same raw image — no need to re-upload.
 */
export async function rejectCutout(fd: FormData): Promise<void> {
  const imageId = fd.get("imageId")?.toString();
  if (!imageId) redirect("/admin/cutouts?err=missing_id");

  const supabase = createServiceRoleClient();
  const { data: img, error: readErr } = await supabase
    .from("product_images")
    .select("id,product_id,state")
    .eq("id", imageId)
    .single();
  if (readErr || !img) redirect("/admin/cutouts?err=not_found");
  if (img.state !== "cutout_pending") {
    redirect(`/admin/cutouts?err=wrong_state&msg=${img.state}`);
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
        `/admin/cutouts?err=db&msg=${encodeURIComponent(resetErr.message)}`,
      );
    }
    await processImage(img.product_id, imageId, "removebg");
    // processImage redirects on its own path; if it returned, fall through.
    revalidatePath("/admin/cutouts");
    revalidatePath("/admin");
    revalidatePath("/");
    redirect("/admin/cutouts?reran=removebg");
  }

  const { error: updErr } = await supabase
    .from("product_images")
    .update({ state: "cutout_rejected" })
    .eq("id", imageId);
  if (updErr) {
    redirect(
      `/admin/cutouts?err=db&msg=${encodeURIComponent(updErr.message)}`,
    );
  }

  revalidatePath("/admin/cutouts");
  revalidatePath(`/admin/products/${img.product_id}/upload`);
  redirect("/admin/cutouts?rejected=1");
}

/** Promote a non-primary approved image to primary. Triggers the
 *  thumbnail sync function on the DB side. */
export async function setPrimary(fd: FormData): Promise<void> {
  const imageId = fd.get("imageId")?.toString();
  if (!imageId) redirect("/admin/cutouts?err=missing_id");
  const supabase = createServiceRoleClient();

  const { data: img } = await supabase
    .from("product_images")
    .select("id,product_id,state")
    .eq("id", imageId)
    .single();
  if (!img) redirect("/admin/cutouts?err=not_found");
  if (img.state !== "cutout_approved") {
    redirect(`/admin/cutouts?err=wrong_state&msg=${img.state}`);
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
      `/admin/cutouts?err=db&msg=${encodeURIComponent(updErr.message)}`,
    );
  }

  revalidatePath("/admin/cutouts");
  revalidatePath("/admin");
  revalidatePath("/");
  revalidatePath(`/admin/products/${img.product_id}/upload`);
  revalidatePath(`/admin/products/${img.product_id}/edit`);
  revalidatePath(`/product/${img.product_id}`);
  redirect("/admin/cutouts?primary=1");
}
