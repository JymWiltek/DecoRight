"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { uploadRawImage, getSignedRawUrl, uploadCutout } from "@/lib/storage";
import {
  getDefaultProvider,
  getProvider,
  RemBgProviderUnavailableError,
} from "@/lib/rembg";
import { QuotaExceededError } from "@/lib/api-usage";
import type { RemBgProviderId } from "@/lib/rembg";

/**
 * Accepts 1..N image files from the upload dropzone. For each file:
 *   1. insert a product_images row (state="raw", no URLs yet) so we
 *      have an id to key the storage path on
 *   2. upload to raw-images bucket at <product>/<image_id>.<ext>
 *   3. patch the row with raw_image_url + state=raw (ready for rembg)
 *
 * Background removal is kicked off in a follow-up step (processImage)
 * so the user sees upload progress without waiting for Replicate.
 */
export async function uploadRawImages(productId: string, fd: FormData) {
  const supabase = createServiceRoleClient();
  const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    redirect(`/admin/products/${productId}/upload?err=no_files`);
  }

  const inserted: string[] = [];
  for (const file of files) {
    const id = crypto.randomUUID();
    // 1) pre-insert to reserve an id
    const { error: insErr } = await supabase.from("product_images").insert({
      id,
      product_id: productId,
      state: "raw",
    });
    if (insErr) {
      redirect(
        `/admin/products/${productId}/upload?err=db&msg=${encodeURIComponent(insErr.message)}`,
      );
    }
    // 2) upload bytes
    try {
      const path = await uploadRawImage(productId, id, file);
      const { error: updErr } = await supabase
        .from("product_images")
        .update({ raw_image_url: path })
        .eq("id", id);
      if (updErr) throw updErr;
      inserted.push(id);
    } catch (err) {
      // rollback the empty row so the queue stays clean
      await supabase.from("product_images").delete().eq("id", id);
      const msg = err instanceof Error ? err.message : String(err);
      redirect(
        `/admin/products/${productId}/upload?err=upload&msg=${encodeURIComponent(msg)}`,
      );
    }
  }

  revalidatePath(`/admin/products/${productId}/upload`);
  revalidatePath(`/admin/cutouts`);
  redirect(
    `/admin/products/${productId}/upload?uploaded=${inserted.length}`,
  );
}

type RembgError =
  | { kind: "missing_raw" }
  | { kind: "no_provider"; providerId?: string }
  | { kind: "quota"; cause: string }
  | { kind: "rembg"; msg: string }
  | { kind: "db"; msg: string };

/**
 * Core rembg worker, extracted so both the single-image form
 * submission AND the batch `processAllRaw` loop can call it without
 * tripping over each other's `redirect()`. Returns a discriminated
 * error on failure instead of throwing, so the caller decides
 * whether to bail or continue.
 */
async function runRembgForImage(
  productId: string,
  imageId: string,
  providerId?: RemBgProviderId,
): Promise<{ ok: true } | { ok: false; error: RembgError }> {
  const supabase = createServiceRoleClient();
  const { data: row, error: readErr } = await supabase
    .from("product_images")
    .select("raw_image_url")
    .eq("id", imageId)
    .single();
  if (readErr || !row?.raw_image_url) {
    return { ok: false, error: { kind: "missing_raw" } };
  }

  let signedUrl: string;
  try {
    signedUrl = await getSignedRawUrl(row.raw_image_url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: { kind: "rembg", msg } };
  }

  const provider = providerId
    ? getProvider(providerId)
    : getDefaultProvider();
  if (!provider) {
    return { ok: false, error: { kind: "no_provider" } };
  }

  try {
    const result = await provider.run({
      sourceUrl: signedUrl,
      productId,
      productImageId: imageId,
    });
    const cutoutUrl = await uploadCutout(productId, imageId, result.bytes);
    const { error: updErr } = await supabase
      .from("product_images")
      .update({
        cutout_image_url: cutoutUrl,
        state: "cutout_pending",
        rembg_provider: result.provider,
        rembg_cost_usd: result.costUsd,
      })
      .eq("id", imageId);
    if (updErr) {
      return { ok: false, error: { kind: "db", msg: updErr.message } };
    }
    return { ok: true };
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      return { ok: false, error: { kind: "quota", cause: err.cause } };
    }
    if (err instanceof RemBgProviderUnavailableError) {
      return {
        ok: false,
        error: { kind: "no_provider", providerId: err.providerId },
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: { kind: "rembg", msg } };
  }
}

/**
 * Server-action wrapper around runRembgForImage: runs rembg on one
 * image, redirects back to the upload page with a success or error
 * query string. Called from the per-card "抠图" button.
 */
export async function processImage(
  productId: string,
  imageId: string,
  providerId?: RemBgProviderId,
): Promise<void> {
  const res = await runRembgForImage(productId, imageId, providerId);
  // Invalidate everywhere the cutout / thumbnail might render. On a
  // reject-and-rerun the cutout_image_url (which the sync trigger
  // also copies into products.thumbnail_url if this row is primary
  // and approved) changes — so /admin and / can go stale too.
  revalidatePath(`/admin/products/${productId}/upload`);
  revalidatePath(`/admin/products/${productId}/edit`);
  revalidatePath(`/admin/cutouts`);
  revalidatePath(`/admin`);
  revalidatePath(`/`);
  revalidatePath(`/product/${productId}`);

  if (!res.ok) {
    const e = res.error;
    switch (e.kind) {
      case "missing_raw":
        redirect(`/admin/products/${productId}/upload?err=missing_raw`);
      case "no_provider":
        redirect(
          `/admin/products/${productId}/upload?err=no_provider&msg=${encodeURIComponent(e.providerId ?? "")}`,
        );
      case "quota":
        redirect(
          `/admin/products/${productId}/upload?err=quota&msg=${encodeURIComponent(e.cause)}`,
        );
      case "rembg":
        redirect(
          `/admin/products/${productId}/upload?err=rembg&msg=${encodeURIComponent(e.msg)}`,
        );
      case "db":
        redirect(
          `/admin/products/${productId}/upload?err=db&msg=${encodeURIComponent(e.msg)}`,
        );
    }
  }
}

/**
 * "Process all raw images for this product" button. Sequential so
 * the daily-quota math matches the audit table row-by-row; a parallel
 * blast would still be correct (advisory lock + server-side reserve)
 * but makes failures messier. Bails on first error.
 */
export async function processAllRaw(productId: string): Promise<void> {
  const supabase = createServiceRoleClient();
  const { data: rows, error } = await supabase
    .from("product_images")
    .select("id")
    .eq("product_id", productId)
    .eq("state", "raw");
  if (error) {
    redirect(
      `/admin/products/${productId}/upload?err=db&msg=${encodeURIComponent(error.message)}`,
    );
  }

  let processed = 0;
  for (const r of rows ?? []) {
    const res = await runRembgForImage(productId, r.id);
    if (!res.ok) {
      // Revalidate what we DID process, then surface the error.
      revalidatePath(`/admin/products/${productId}/upload`);
      revalidatePath(`/admin/cutouts`);
      const e = res.error;
      const msg =
        e.kind === "rembg" || e.kind === "db"
          ? e.msg
          : e.kind === "quota"
            ? e.cause
            : e.kind === "no_provider"
              ? (e.providerId ?? "")
              : "";
      redirect(
        `/admin/products/${productId}/upload?err=${e.kind}&msg=${encodeURIComponent(msg)}`,
      );
    }
    processed++;
  }

  revalidatePath(`/admin/products/${productId}/upload`);
  revalidatePath(`/admin/cutouts`);
  redirect(`/admin/cutouts?reran=${processed}`);
}
