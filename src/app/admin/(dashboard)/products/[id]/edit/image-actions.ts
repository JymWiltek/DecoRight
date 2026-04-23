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
 * Image pipeline (post-migration 0010 auto-cutout):
 *
 *   uploadRawImages   : dropzone hits this. Per file we insert a row
 *                       (state=raw), upload to raw-images bucket, then
 *                       synchronously call runRembgForImage in AUTO
 *                       mode → on success the row lands at
 *                       cutout_approved (+ is_primary=true if this is
 *                       the product's first approved image, which
 *                       triggers the DB-side thumbnail sync). On
 *                       failure the row lands at cutout_failed with
 *                       raw_image_url intact so Retry works.
 *
 *   retryFailedImage  : Retry button on a cutout_failed row. Reruns
 *                       rembg on the same raw_image_url through the
 *                       provider the operator picks (Replicate by
 *                       default, or Remove.bg). Goes through the same
 *                       AUTO mode as the initial upload.
 *
 *   markImageUnsatisfied : × button on a cutout_approved thumbnail.
 *                       Moves the row to user_rejected, clears
 *                       is_primary, and auto-promotes the next
 *                       cutout_approved row to primary (or clears
 *                       products.thumbnail_url if there are no more
 *                       approved images).
 *
 *   deleteProductImage : hard-delete a row + its storage objects.
 *
 *   processImage / processAllRaw / runRembgForImage (review mode) :
 *                       the legacy /admin/cutouts review-queue flow is
 *                       still supported because rejectCutout's
 *                       "Re-run on Remove.bg" path calls processImage
 *                       directly. Review-mode runs land at
 *                       cutout_pending so a human can approve manually.
 */

/**
 * Optional `returnTo` support: image actions are driven from:
 *   - /admin/products/[id]/edit  (the product workbench — default)
 *   - /admin/cutouts             (the review queue)
 * Whichever page the form lives on, it passes returnTo=<its path>
 * and we redirect back there. Unset → default to the edit page.
 * Only same-origin admin paths are allowed (open-redirect guard).
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

function parseProviderId(v: string | null | undefined): RemBgProviderId | undefined {
  return v === "replicate_rembg" || v === "removebg"
    ? (v as RemBgProviderId)
    : undefined;
}

/**
 * Dropzone entry-point. Accepts 1..N image files, and for each one:
 *   1. inserts a product_images row (state=raw)
 *   2. uploads bytes to the raw-images bucket
 *   3. runs rembg in AUTO mode (success → cutout_approved + first-one
 *      promoted to primary; failure → cutout_failed for Retry)
 *
 * Everything is synchronous inside the server action so the redirect
 * URL reflects the final truth — `?uploaded=3&failed=1` means 3 are
 * already approved with thumbnails synced, 1 needs a retry. No
 * intermediate review step, no polling.
 *
 * We process files sequentially (not parallel) because rembg is
 * quota-metered via an advisory lock inside reserve_api_slot(), and
 * sequential calls give us cleaner audit rows in api_usage. 5–10s per
 * image is acceptable for a small batch; larger batches should use
 * the legacy processAllRaw button.
 */
export async function uploadRawImages(productId: string, fd: FormData) {
  const supabase = createServiceRoleClient();
  const returnTo = safeReturnTo(fd) ?? `/admin/products/${productId}/edit`;
  const files = fd
    .getAll("files")
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    redirect(withQuery(returnTo, "err", "no_files"));
  }

  let uploaded = 0;
  let approved = 0;
  let failed = 0;
  let lastErrorKind: string | null = null;
  let lastErrorMsg: string | null = null;

  for (const file of files) {
    const id = crypto.randomUUID();

    // 1) pre-insert to reserve an id
    const { error: insErr } = await supabase.from("product_images").insert({
      id,
      product_id: productId,
      state: "raw",
    });
    if (insErr) {
      lastErrorKind = "db";
      lastErrorMsg = insErr.message;
      failed++;
      continue;
    }

    // 2) upload bytes
    try {
      const path = await uploadRawImage(productId, id, file);
      const { error: updErr } = await supabase
        .from("product_images")
        .update({ raw_image_url: path })
        .eq("id", id);
      if (updErr) throw updErr;
      uploaded++;
    } catch (err) {
      // Rollback the empty row so the queue stays clean.
      await supabase.from("product_images").delete().eq("id", id);
      lastErrorKind = "upload";
      lastErrorMsg = err instanceof Error ? err.message : String(err);
      failed++;
      continue;
    }

    // 3) auto-pipeline: rembg → approve → primary-if-first
    const res = await autoProcessImage(productId, id);
    if (res.ok) {
      approved++;
    } else {
      lastErrorKind = res.error.kind;
      lastErrorMsg =
        res.error.kind === "rembg" || res.error.kind === "db"
          ? res.error.msg
          : res.error.kind === "quota"
            ? res.error.cause
            : res.error.kind === "no_provider"
              ? (res.error.providerId ?? "no default provider configured")
              : "";
      failed++;
    }
  }

  // Fan out revalidation — auto-approve already copied cutout URLs
  // into products.thumbnail_url via the sync trigger, so public pages
  // need to drop their caches too.
  revalidatePath(`/admin/products/${productId}/edit`);
  revalidatePath(`/admin/cutouts`);
  revalidatePath(`/admin`);
  revalidatePath(`/`);
  revalidatePath(`/product/${productId}`);

  let target = withQuery(returnTo, "uploaded", String(uploaded));
  target = withQuery(target, "approved", String(approved));
  if (failed > 0) {
    target = withQuery(target, "failed", String(failed));
    if (lastErrorKind) {
      target = withQuery(target, "err", lastErrorKind);
    }
    if (lastErrorMsg) {
      target = withQuery(target, "msg", lastErrorMsg);
    }
  }
  redirect(target);
}

type RembgError =
  | { kind: "missing_raw" }
  | { kind: "no_provider"; providerId?: string }
  | { kind: "quota"; cause: string }
  | { kind: "rembg"; msg: string }
  | { kind: "db"; msg: string };

type RembgMode = "review" | "auto";

/**
 * Core rembg worker. Does the expensive paid call, uploads the cutout,
 * and writes the new state into product_images in ONE update so the
 * DB sync trigger fires at most once.
 *
 * mode="review" (legacy queue) : state → cutout_pending, is_primary
 *                                untouched. A human approves later.
 *
 * mode="auto"   (dropzone)     : state → cutout_approved, and
 *                                is_primary=true iff this product has
 *                                no other primary yet. The trigger
 *                                then copies cutout_image_url into
 *                                products.thumbnail_url.
 *
 * Returns a discriminated result instead of throwing; the caller
 * decides whether to redirect with ?err= or silently continue.
 */
async function runRembgForImage(
  productId: string,
  imageId: string,
  providerId: RemBgProviderId | undefined,
  mode: RembgMode,
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

    if (mode === "review") {
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
    }

    // AUTO mode — do we already have a primary for this product? If
    // not, this one becomes primary in the same UPDATE. Checking
    // existence via a separate query instead of trusting the partial
    // unique index to "just promote" because the index only rejects
    // duplicates; it won't auto-pick one when two uploads race.
    const { data: existingPrimary } = await supabase
      .from("product_images")
      .select("id")
      .eq("product_id", productId)
      .eq("is_primary", true)
      .maybeSingle();

    const patch: {
      cutout_image_url: string;
      state: "cutout_approved";
      rembg_provider: string;
      rembg_cost_usd: number | null;
      is_primary?: boolean;
    } = {
      cutout_image_url: cutoutUrl,
      state: "cutout_approved",
      rembg_provider: result.provider,
      rembg_cost_usd: result.costUsd,
    };
    if (!existingPrimary) patch.is_primary = true;

    const { error: updErr } = await supabase
      .from("product_images")
      .update(patch)
      .eq("id", imageId);
    if (updErr) {
      return { ok: false, error: { kind: "db", msg: updErr.message } };
    }
    return { ok: true };
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      // Park the row at cutout_failed so the UI surfaces Retry —
      // quota resets daily and a retry tomorrow will go through.
      if (mode === "auto") {
        await supabase
          .from("product_images")
          .update({ state: "cutout_failed" })
          .eq("id", imageId);
      }
      return { ok: false, error: { kind: "quota", cause: err.cause } };
    }
    if (err instanceof RemBgProviderUnavailableError) {
      if (mode === "auto") {
        await supabase
          .from("product_images")
          .update({ state: "cutout_failed" })
          .eq("id", imageId);
      }
      return {
        ok: false,
        error: { kind: "no_provider", providerId: err.providerId },
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (mode === "auto") {
      await supabase
        .from("product_images")
        .update({ state: "cutout_failed" })
        .eq("id", imageId);
    }
    return { ok: false, error: { kind: "rembg", msg } };
  }
}

/** Thin alias used inline by uploadRawImages — runs rembg in AUTO mode. */
async function autoProcessImage(
  productId: string,
  imageId: string,
  providerId?: RemBgProviderId,
): Promise<{ ok: true } | { ok: false; error: RembgError }> {
  return runRembgForImage(productId, imageId, providerId, "auto");
}

/**
 * Retry button on a cutout_failed row. Reuses raw_image_url; no
 * re-upload. Resets state=raw momentarily so runRembgForImage's
 * read doesn't get confused, then runs in AUTO mode.
 */
export async function retryFailedImage(fd: FormData): Promise<void> {
  const imageId = fd.get("imageId")?.toString();
  const productId = fd.get("productId")?.toString();
  const providerId = parseProviderId(fd.get("providerId")?.toString());
  const returnTo = safeReturnTo(fd);
  const base = returnTo ?? (productId ? `/admin/products/${productId}/edit` : "/admin");

  if (!imageId || !productId) {
    redirect(withQuery(base, "err", "missing_id"));
  }

  const supabase = createServiceRoleClient();
  // Reset to raw so the row is clean for a fresh rembg pass. We do
  // NOT clear cutout_image_url — if Retry also fails, the previous
  // (failed) cutout is gone anyway; the row was cutout_failed, so
  // cutout_image_url was already null.
  const { error: resetErr } = await supabase
    .from("product_images")
    .update({
      state: "raw",
      cutout_image_url: null,
      rembg_provider: null,
      rembg_cost_usd: null,
    })
    .eq("id", imageId)
    .eq("product_id", productId);
  if (resetErr) {
    redirect(withQuery(withQuery(base, "err", "db"), "msg", resetErr.message));
  }

  const res = await autoProcessImage(productId, imageId, providerId);
  revalidatePath(`/admin/products/${productId}/edit`);
  revalidatePath(`/admin/cutouts`);
  revalidatePath(`/admin`);
  revalidatePath(`/`);
  revalidatePath(`/product/${productId}`);

  if (!res.ok) {
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
  redirect(withQuery(base, "retried", "1"));
}

/**
 * × button on an approved thumbnail. Operator is saying "the rembg
 * result is fine, but I don't want this photo to represent the
 * product." Different from cutout_rejected (which meant "rembg
 * produced crap") — user_rejected is terminal for that raw image.
 *
 * If the rejected row was the primary, we auto-promote the next
 * cutout_approved row (oldest first — "first approved" convention
 * matches what auto-pipeline does for initial primaries). If none
 * exists, clear products.thumbnail_url so the catalog falls back to
 * a placeholder instead of rendering a broken image.
 */
export async function markImageUnsatisfied(fd: FormData): Promise<void> {
  const imageId = fd.get("imageId")?.toString();
  const returnTo = safeReturnTo(fd);

  if (!imageId) {
    redirect(
      withQuery(returnTo ?? "/admin", "err", "missing_id"),
    );
  }

  const supabase = createServiceRoleClient();
  const { data: img, error: readErr } = await supabase
    .from("product_images")
    .select("id,product_id,is_primary,state")
    .eq("id", imageId)
    .single();
  if (readErr || !img) {
    redirect(withQuery(returnTo ?? "/admin", "err", "not_found"));
  }

  const base = returnTo ?? `/admin/products/${img.product_id}/edit`;

  if (img.state !== "cutout_approved") {
    redirect(
      withQuery(withQuery(base, "err", "wrong_state"), "msg", img.state),
    );
  }

  const wasPrimary = img.is_primary;

  // Flip to user_rejected + drop the primary flag in one UPDATE.
  const { error: updErr } = await supabase
    .from("product_images")
    .update({ state: "user_rejected", is_primary: false })
    .eq("id", imageId);
  if (updErr) {
    redirect(withQuery(withQuery(base, "err", "db"), "msg", updErr.message));
  }

  if (wasPrimary) {
    // Promote the next approved (oldest first — first-approved wins,
    // matching the auto-pipeline's own initial-primary rule).
    const { data: candidate } = await supabase
      .from("product_images")
      .select("id")
      .eq("product_id", img.product_id)
      .eq("state", "cutout_approved")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (candidate) {
      // Setting is_primary=true fires the sync trigger which copies
      // the candidate's cutout_image_url into products.thumbnail_url.
      const { error: promoteErr } = await supabase
        .from("product_images")
        .update({ is_primary: true })
        .eq("id", candidate.id);
      if (promoteErr) {
        redirect(
          withQuery(withQuery(base, "err", "db"), "msg", promoteErr.message),
        );
      }
    } else {
      // No approved images left — clear the thumbnail so the catalog
      // doesn't render a 404. (The trigger only propagates NEW
      // primary URLs; it does not unset on primary removal.)
      await supabase
        .from("products")
        .update({ thumbnail_url: null })
        .eq("id", img.product_id);
    }
  }

  revalidatePath(`/admin/products/${img.product_id}/edit`);
  revalidatePath(`/admin/cutouts`);
  revalidatePath(`/admin`);
  revalidatePath(`/`);
  revalidatePath(`/product/${img.product_id}`);
  redirect(withQuery(base, "unsatisfied", "1"));
}

/**
 * Server-action wrapper around runRembgForImage in REVIEW mode.
 * Only reachable from the legacy /admin/cutouts flow (rejectCutout's
 * "Re-run on Remove.bg" path calls this directly). New dropzone
 * uploads go through uploadRawImages → autoProcessImage instead.
 *
 * Callable two ways:
 *   1. Directly with (productId, imageId, providerId) — from
 *      rejectCutout(rerun="removebg"). No returnTo available.
 *   2. As a <form action> with productId/imageId/providerId/returnTo.
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
    providerId = parseProviderId(fd.get("providerId")?.toString());
    returnTo = safeReturnTo(fd);
  } else {
    [productId, imageId, providerId] = args as [
      string,
      string,
      RemBgProviderId?,
    ];
  }
  const base = returnTo ?? `/admin/products/${productId}/edit`;

  const res = await runRembgForImage(productId, imageId, providerId, "review");
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
}

/**
 * Legacy "Process all raw images for this product" entry-point. Kept
 * working for the /admin/cutouts flow; new uploads don't leave rows
 * in `raw` state long enough for this to be useful on the workbench.
 * REVIEW mode (rows land at cutout_pending).
 */
export async function processAllRaw(
  productId: string,
  fd?: FormData,
): Promise<void> {
  const supabase = createServiceRoleClient();
  const returnTo = fd ? safeReturnTo(fd) : null;
  const base = returnTo ?? `/admin/products/${productId}/edit`;

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
    const res = await runRembgForImage(productId, r.id, undefined, "review");
    if (!res.ok) {
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

  revalidatePath(`/admin/products/${productId}/edit`);
  revalidatePath(`/admin/cutouts`);
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
 * here too (or auto-promote another approved image) to keep /admin
 * and / from rendering a broken image.
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

  // If the deleted row was the synced primary, auto-promote the next
  // approved image (same convention as markImageUnsatisfied) so the
  // product doesn't suddenly go thumbnail-less when any one photo is
  // pruned. If no approved candidate exists, clear thumbnail_url.
  if (img.is_primary) {
    const { data: candidate } = await supabase
      .from("product_images")
      .select("id")
      .eq("product_id", img.product_id)
      .eq("state", "cutout_approved")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (candidate) {
      await supabase
        .from("product_images")
        .update({ is_primary: true })
        .eq("id", candidate.id);
    } else {
      await supabase
        .from("products")
        .update({ thumbnail_url: null })
        .eq("id", img.product_id);
    }
  }

  revalidatePath(`/admin/products/${img.product_id}/edit`);
  revalidatePath(`/admin/cutouts`);
  revalidatePath("/admin");
  revalidatePath("/");
  revalidatePath(`/product/${img.product_id}`);
  redirect(withQuery(errBase, "deleted", "1"));
}
