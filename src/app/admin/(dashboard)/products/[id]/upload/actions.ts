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
 * Optional `returnTo` support: image actions can be driven from
 *   - /admin/products/[id]/upload (legacy — commit 3 deletes)
 *   - /admin/products/[id]/edit   (the new workbench)
 * Whichever page the form lives on, it passes returnTo=<its path>
 * and we redirect back there instead of hard-coding /upload.
 * Only same-origin admin paths are allowed.
 */
function safeReturnTo(fd: FormData): string | null {
  const v = fd.get("returnTo")?.toString();
  if (!v) return null;
  if (!v.startsWith("/admin/")) return null;
  return v;
}

function withQuery(path: string, key: string, value: string): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}${key}=${encodeURIComponent(value)}`;
}

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
  const returnTo =
    safeReturnTo(fd) ?? `/admin/products/${productId}/upload`;
  const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    redirect(withQuery(returnTo, "err", "no_files"));
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
        withQuery(withQuery(returnTo, "err", "db"), "msg", insErr.message),
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
      redirect(withQuery(withQuery(returnTo, "err", "upload"), "msg", msg));
    }
  }

  revalidatePath(`/admin/products/${productId}/upload`);
  revalidatePath(`/admin/products/${productId}/edit`);
  revalidatePath(`/admin/cutouts`);
  redirect(withQuery(returnTo, "uploaded", String(inserted.length)));
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
 * image, redirects back to the caller's page with a success or error
 * query string. Called from the per-card "Cut out" button on either
 * the upload page OR the edit workbench.
 *
 * Callable two ways:
 *   1. Directly with (productId, imageId, providerId) — legacy path
 *      used by /upload's bound form + /cutouts rejectCutout rerun.
 *      No returnTo available here, so defaults to /upload.
 *   2. As a <form action> with productId/imageId/providerId/returnTo
 *      in FormData — used by the inline buttons on /edit. Respects
 *      returnTo.
 */
export async function processImage(
  ...args:
    | [productId: string, imageId: string, providerId?: RemBgProviderId]
    | [fd: FormData]
): Promise<void> {
  let productId: string;
  let imageId: string;
  let providerId: RemBgProviderId | undefined;
  let returnTo: string | null = null;
  if (args.length === 1 && args[0] instanceof FormData) {
    const fd = args[0];
    productId = fd.get("productId")?.toString() ?? "";
    imageId = fd.get("imageId")?.toString() ?? "";
    const p = fd.get("providerId")?.toString();
    providerId =
      p === "replicate_rembg" || p === "removebg"
        ? (p as RemBgProviderId)
        : undefined;
    returnTo = safeReturnTo(fd);
  } else {
    [productId, imageId, providerId] = args as [
      string,
      string,
      RemBgProviderId?,
    ];
  }
  const base = returnTo ?? `/admin/products/${productId}/upload`;

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
        redirect(withQuery(base, "err", "missing_raw"));
      case "no_provider":
        redirect(
          withQuery(
            withQuery(base, "err", "no_provider"),
            "msg",
            e.providerId ?? "",
          ),
        );
      case "quota":
        redirect(
          withQuery(withQuery(base, "err", "quota"), "msg", e.cause),
        );
      case "rembg":
        redirect(withQuery(withQuery(base, "err", "rembg"), "msg", e.msg));
      case "db":
        redirect(withQuery(withQuery(base, "err", "db"), "msg", e.msg));
    }
  }
  // On success we return void — the caller's form sits on either
  // /upload or /edit; revalidatePath(...) above makes that same page
  // re-render with the updated state row. No explicit redirect.
}

/**
 * "Process all raw images for this product" button. Sequential so
 * the daily-quota math matches the audit table row-by-row; a parallel
 * blast would still be correct (advisory lock + server-side reserve)
 * but makes failures messier. Bails on first error.
 */
export async function processAllRaw(
  productId: string,
  fd?: FormData,
): Promise<void> {
  const supabase = createServiceRoleClient();
  const returnTo = fd ? safeReturnTo(fd) : null;
  const base = returnTo ?? `/admin/products/${productId}/upload`;

  const { data: rows, error } = await supabase
    .from("product_images")
    .select("id")
    .eq("product_id", productId)
    .eq("state", "raw");
  if (error) {
    redirect(withQuery(withQuery(base, "err", "db"), "msg", error.message));
  }

  let processed = 0;
  for (const r of rows ?? []) {
    const res = await runRembgForImage(productId, r.id);
    if (!res.ok) {
      // Revalidate what we DID process, then surface the error.
      revalidatePath(`/admin/products/${productId}/upload`);
      revalidatePath(`/admin/products/${productId}/edit`);
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
      redirect(withQuery(withQuery(base, "err", e.kind), "msg", msg));
    }
    processed++;
  }

  revalidatePath(`/admin/products/${productId}/upload`);
  revalidatePath(`/admin/products/${productId}/edit`);
  revalidatePath(`/admin/cutouts`);
  // Default: drop the operator into the review queue with a batch
  // success banner. When driven from the edit workbench, returnTo
  // keeps them on the product page so they can continue reviewing
  // inline without a context switch.
  redirect(
    returnTo
      ? withQuery(base, "processed", String(processed))
      : `/admin/cutouts?reran=${processed}`,
  );
}

/**
 * Delete a single product_image row and its stored files. Admin-only
 * — the UI button is guarded with a confirm(). We also clear the
 * primary flag implicitly (row is gone; partial unique index no
 * longer has a row pointing here). If the deleted row was the primary
 * and it had already been synced into products.thumbnail_url, the
 * thumbnail column is left pointing at a now-404 URL — we wipe it
 * here too to keep /admin and / from rendering a broken image.
 *
 * Storage cleanup is best-effort: if a remove() fails (file already
 * gone, network blip) we still delete the DB row — a stray orphan in
 * storage is less bad than a zombie row with a dead URL.
 */
export async function deleteProductImage(fd: FormData): Promise<void> {
  const imageId = fd.get("imageId")?.toString();
  const returnTo = safeReturnTo(fd);

  if (!imageId) {
    redirect(
      withQuery(returnTo ?? "/admin/cutouts", "err", "missing_id"),
    );
  }

  const supabase = createServiceRoleClient();

  // Read first so we know the product_id (for revalidate + storage
  // paths) and the raw/cutout urls (for storage cleanup).
  const { data: img, error: readErr } = await supabase
    .from("product_images")
    .select("id,product_id,raw_image_url,cutout_image_url,is_primary")
    .eq("id", imageId)
    .single();
  if (readErr || !img) {
    redirect(
      withQuery(returnTo ?? "/admin/cutouts", "err", "not_found"),
    );
  }

  const errBase =
    returnTo ?? `/admin/products/${img.product_id}/edit`;

  // Best-effort storage removal.
  if (img.raw_image_url) {
    await supabase.storage.from("raw-images").remove([img.raw_image_url]);
  }
  // cutout_image_url is a public URL with `?v=<ts>` busting — strip
  // the query, then derive the path `<product_id>/<image_id>.png`.
  // Using the known convention is safer than parsing the URL.
  await supabase.storage
    .from("cutouts")
    .remove([`${img.product_id}/${imageId}.png`]);

  // Delete the row.
  const { error: delErr } = await supabase
    .from("product_images")
    .delete()
    .eq("id", imageId);
  if (delErr) {
    redirect(withQuery(withQuery(errBase, "err", "db"), "msg", delErr.message));
  }

  // If the deleted row was the synced primary, clear the product's
  // thumbnail_url so the catalog stops rendering a broken image.
  // The sync trigger only RUNS thumbnail copies; it doesn't unset.
  if (img.is_primary) {
    await supabase
      .from("products")
      .update({ thumbnail_url: null })
      .eq("id", img.product_id);
  }

  revalidatePath(`/admin/products/${img.product_id}/upload`);
  revalidatePath(`/admin/products/${img.product_id}/edit`);
  revalidatePath(`/admin/cutouts`);
  revalidatePath("/admin");
  revalidatePath("/");
  revalidatePath(`/product/${img.product_id}`);
  redirect(withQuery(errBase, "deleted", "1"));
}
