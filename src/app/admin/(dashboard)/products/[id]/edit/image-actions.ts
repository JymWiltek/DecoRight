"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { runRembgForImage } from "@/lib/rembg/pipeline";
import type { RemBgProviderId } from "@/lib/rembg";
import { copyRawToCutouts } from "@/lib/storage";

/**
 * Image pipeline (post-migration 0010 auto-cutout; post direct-upload
 * refactor 2026-04):
 *
 *   Dropzone uploads no longer flow through a server action. The
 *   browser PUTs raw bytes straight into Storage via a signed URL and
 *   then calls `attachRawImages` + `kickRembgPipeline` (see
 *   `../upload-actions.ts`). That move was forced by Vercel Hobby's
 *   4.5 MB platform body cap — a 47 MB GLB (or a batch of phone
 *   photos) never made it to the server action at all.
 *
 *   What still lives here:
 *
 *   retryFailedImage  : Retry button on a cutout_failed row. Reuses
 *                       the existing raw_image_url; no re-upload.
 *                       Runs rembg in AUTO mode through the provider
 *                       the operator picks.
 *
 *   markImageUnsatisfied : × button on a cutout_approved thumbnail.
 *                       Moves the row to user_rejected, clears
 *                       is_primary, and auto-promotes the next
 *                       cutout_approved row to primary (or clears
 *                       products.thumbnail_url if none remain).
 *
 *   deleteProductImage : hard-delete a row + its storage objects.
 *
 *   processImage / processAllRaw : legacy /admin/cutouts review queue
 *                       flow. Review mode (rows land at
 *                       cutout_pending for human approval). Still
 *                       reachable from rejectCutout's "Re-run on
 *                       Remove.bg" path.
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
      // P0-2: clear last_error_kind so a successful retry doesn't
      // leave the previous failure category dangling on the row.
      last_error_kind: null,
    })
    .eq("id", imageId)
    .eq("product_id", productId);
  if (resetErr) {
    redirect(withQuery(withQuery(base, "err", "db"), "msg", resetErr.message));
  }

  const res = await runRembgForImage(productId, imageId, providerId, "auto");
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
 * "Skip — already clean" button on a raw row. Operator is saying the
 * uploaded photo doesn't need rembg (clean white backdrop, reflective
 * surface rembg would mangle, wood grain, etc). We copy the raw bytes
 * into the public cutouts bucket and land the row at cutout_approved
 * — same terminal state a successful rembg run produces — so the
 * existing publish gate, sync_primary_thumbnail trigger, and
 * storefront gallery query all keep working without touching them.
 *
 * skip_cutout=true is set as an audit flag so:
 *   • the admin ImageCard can render a "skipped" badge instead of
 *     "rembg via replicate · $0.002"
 *   • cost reports can distinguish $0-spent skipped images from
 *     un-attempted-yet rows (last_error_kind=null + rembg_cost_usd=null
 *     is ambiguous otherwise).
 *
 * Primary handling mirrors `runRembgForImage` AUTO mode: if the
 * product currently has no cutout_approved primary, this row becomes
 * the primary and the trigger syncs cutout_image_url into
 * products.thumbnail_url. Otherwise we don't touch is_primary —
 * existing primary keeps its claim.
 *
 * Pre-conditions: row must exist, must be in `raw` state (matches
 * the spot where the button is rendered in ProductImagesSection),
 * and must have a raw_image_url to copy from. Other states (failed,
 * approved, rejected) get rejected with `wrong_state` rather than
 * silently no-oping — operator should retry / delete those instead.
 */
export async function markImageSkipCutout(fd: FormData): Promise<void> {
  const imageId = fd.get("imageId")?.toString();
  const productId = fd.get("productId")?.toString();
  const returnTo = safeReturnTo(fd);
  const base =
    returnTo ?? (productId ? `/admin/products/${productId}/edit` : "/admin");

  if (!imageId || !productId) {
    redirect(withQuery(base, "err", "missing_id"));
  }

  const supabase = createServiceRoleClient();

  // Read the row + check for an existing primary in parallel. The
  // primary check decides whether THIS row gets is_primary=true
  // (matches runRembgForImage AUTO mode's "first approved wins"
  // convention).
  const [imgRes, primaryRes] = await Promise.all([
    supabase
      .from("product_images")
      .select("id,product_id,state,raw_image_url")
      .eq("id", imageId)
      .single(),
    supabase
      .from("product_images")
      .select("id")
      .eq("product_id", productId)
      .eq("is_primary", true)
      .maybeSingle(),
  ]);

  if (imgRes.error || !imgRes.data) {
    redirect(withQuery(base, "err", "not_found"));
  }
  const img = imgRes.data;

  if (img.product_id !== productId) {
    // Belt-and-suspenders: the form submits both, and the imageId
    // must belong to the productId. Cross-product writes would let
    // a crafted FormData hijack a row from another product.
    redirect(withQuery(base, "err", "product_mismatch"));
  }

  if (img.state !== "raw") {
    redirect(
      withQuery(withQuery(base, "err", "wrong_state"), "msg", img.state),
    );
  }

  if (!img.raw_image_url) {
    // The button is only rendered for state='raw' rows, all of which
    // have raw_image_url (set by the dropzone direct-upload action).
    // This branch covers the edge where a row got stuck mid-upload.
    redirect(withQuery(base, "err", "missing_raw"));
  }

  // Copy raw bytes → public cutouts bucket. Returns the public URL
  // with a cache-bust suffix so the CDN doesn't serve a stale object
  // if the operator re-skips after replacing the raw.
  let cutoutUrl: string;
  try {
    cutoutUrl = await copyRawToCutouts(img.raw_image_url, productId, imageId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    redirect(withQuery(withQuery(base, "err", "storage"), "msg", msg));
  }

  // Land at cutout_approved with the audit flag. is_primary fires
  // sync_primary_thumbnail (mig 0009) iff this is the first primary
  // for the product. rembg_provider/cost stay NULL — this row never
  // touched a paid provider. last_error_kind is cleared defensively
  // (it should already be NULL on a raw row, but leaving stale data
  // is sloppy).
  const patch: {
    state: "cutout_approved";
    cutout_image_url: string;
    skip_cutout: true;
    rembg_provider: null;
    rembg_cost_usd: null;
    last_error_kind: null;
    is_primary?: boolean;
  } = {
    state: "cutout_approved",
    cutout_image_url: cutoutUrl,
    skip_cutout: true,
    rembg_provider: null,
    rembg_cost_usd: null,
    last_error_kind: null,
  };
  if (!primaryRes.data) patch.is_primary = true;

  const { error: updErr } = await supabase
    .from("product_images")
    .update(patch)
    .eq("id", imageId)
    .eq("product_id", productId);
  if (updErr) {
    redirect(withQuery(withQuery(base, "err", "db"), "msg", updErr.message));
  }

  revalidatePath(`/admin/products/${productId}/edit`);
  revalidatePath(`/admin/cutouts`);
  revalidatePath(`/admin`);
  revalidatePath(`/`);
  revalidatePath(`/product/${productId}`);
  redirect(withQuery(base, "skipped", "1"));
}

/**
 * Server-action wrapper around runRembgForImage in REVIEW mode.
 * Only reachable from the legacy /admin/cutouts flow (rejectCutout's
 * "Re-run on Remove.bg" path calls this directly). Direct-upload
 * dropzone flows auto-run rembg via `kickRembgPipeline` instead.
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
      case "image_too_large":
        redirect(
          withQuery(
            withQuery(base, "err", "image_too_large"),
            "msg",
            `${e.bytes} bytes`,
          ),
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

// ────────────────────────────────────────────────────────────
// Wave 5 (mig 0038) — toggle actions for the flat image-pool model.
// ────────────────────────────────────────────────────────────

/** Mig 0038 — toggle one of the three booleans on a product_images
 *  row. Single action serving all three toggles via a `field`
 *  selector so the admin form can use a single <form action=…> per
 *  checkbox without forking three near-identical copies.
 *
 *  Auth: requireAdmin via the proxy middleware (this is a server
 *  action, not a route handler; the standard admin gate covers it).
 *
 *  Validation:
 *    • imageId must exist + belong to a product.
 *    • field must be one of the 3 known toggles.
 *    • value parsed as "true" / "false" — anything else returns
 *      err=bad_value.
 *
 *  After the UPDATE the action revalidates the admin edit page so
 *  the toggle's new state is reflected on the next render.
 *  Storefront catalog cache is invalidated indirectly when
 *  is_primary_thumbnail changes — the unify route's pg_net trigger
 *  fires (mig 0038's rewrite of mig 0035 watches
 *  is_primary_thumbnail) which calls revalidatePath inside the
 *  route. Direct revalidation here would be redundant. */
export async function setImageToggle(fd: FormData): Promise<void> {
  const imageId = fd.get("imageId")?.toString();
  const field = fd.get("field")?.toString();
  const value = fd.get("value")?.toString();
  const returnTo = safeReturnTo(fd);

  if (!imageId || !field || !value) {
    redirect(withQuery(returnTo ?? "/admin", "err", "missing_arg"));
  }
  if (
    field !== "show_on_storefront" &&
    field !== "is_primary_thumbnail" &&
    field !== "feed_to_ai"
  ) {
    redirect(withQuery(returnTo ?? "/admin", "err", "bad_field"));
  }
  if (value !== "true" && value !== "false") {
    redirect(withQuery(returnTo ?? "/admin", "err", "bad_value"));
  }

  const supabase = createServiceRoleClient();
  const { data: img, error: readErr } = await supabase
    .from("product_images")
    .select("id,product_id")
    .eq("id", imageId)
    .single();
  if (readErr || !img) {
    redirect(withQuery(returnTo ?? "/admin", "err", "not_found"));
  }

  const base = returnTo ?? `/admin/products/${img.product_id}/edit`;
  const newVal = value === "true";

  // Build the partial update — only the field the operator toggled.
  // Use a typed Update shape so supabase-js's RejectExcessProperties
  // accepts it. The runtime guard above already pinned `field` to
  // one of the three legal column names; this just makes tsc happy.
  type ImagePatch = {
    show_on_storefront?: boolean;
    is_primary_thumbnail?: boolean;
    feed_to_ai?: boolean;
  };
  const patch: ImagePatch = {};
  if (field === "show_on_storefront") patch.show_on_storefront = newVal;
  else if (field === "is_primary_thumbnail") patch.is_primary_thumbnail = newVal;
  else if (field === "feed_to_ai") patch.feed_to_ai = newVal;

  const { error: updErr } = await supabase
    .from("product_images")
    .update(patch)
    .eq("id", imageId);
  if (updErr) {
    redirect(withQuery(withQuery(base, "err", "db"), "msg", updErr.message));
  }

  revalidatePath(`/admin/products/${img.product_id}/edit`);
  // The storefront product page reads show_on_storefront +
  // is_primary_thumbnail at render time; bust its cache so toggles
  // reflect immediately without waiting for ISR.
  revalidatePath(`/product/${img.product_id}`);
  redirect(withQuery(base, "toggled", field));
}
