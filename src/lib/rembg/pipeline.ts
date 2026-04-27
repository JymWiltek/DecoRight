import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/service";
import { getSignedRawUrl, uploadCutout } from "@/lib/storage";
import {
  getDefaultProvider,
  getProvider,
  RemBgProviderUnavailableError,
  type RemBgProviderId,
} from "@/lib/rembg";
import { QuotaExceededError } from "@/lib/api-usage";
import type { ImageErrorKind } from "@/lib/supabase/types";

/** Hard ceiling fed to providers. Replicate's rembg model and
 *  Remove.bg both accept up to ~10 MB; we stop at 8 MB so the upload
 *  fails fast with a clear category instead of a 30-second download
 *  followed by a cryptic provider error. Tuned by prod telemetry —
 *  in 6 months of operator photos nothing legitimate has crossed 5 MB
 *  (raw iPhone HEIC → JPEG conversions land around 2-3 MB). */
const MAX_RAW_BYTES = 8 * 1024 * 1024;

/**
 * Shared rembg pipeline. Historically lived inside
 * `products/[id]/edit/image-actions.ts` where it was invoked
 * synchronously by the "upload files via FormData → server action"
 * flow. We extracted it here so the new direct-upload flow (client
 * PUTs bytes straight to Storage, then calls a small server action
 * to attach + kick rembg) can reuse the exact same worker.
 *
 * The worker is intentionally a plain ES module — no "use server"
 * — so importers can call it without exposing it as a public RPC.
 * The admin gate lives on the calling server action, not here.
 */

export type RembgError =
  | { kind: "missing_raw" }
  | { kind: "no_provider"; providerId?: string }
  | { kind: "quota"; cause: string }
  | { kind: "rembg"; msg: string }
  | { kind: "db"; msg: string };

export type RembgMode = "review" | "auto";

export type RembgResult =
  | { ok: true }
  | { ok: false; error: RembgError };

/**
 * Runs rembg for one image row. Assumes the row exists with a valid
 * `raw_image_url` already populated (i.e. the raw bytes are in
 * Storage). On failure the row is parked at cutout_failed (auto mode)
 * so the UI surfaces Retry and the raw bytes aren't lost.
 *
 * mode="auto"   (dropzone / direct-upload) : state → cutout_approved,
 *                                            is_primary=true iff the
 *                                            product has no primary
 *                                            yet. The DB sync trigger
 *                                            then copies
 *                                            cutout_image_url into
 *                                            products.thumbnail_url.
 *
 * mode="review" (legacy queue)             : state → cutout_pending,
 *                                            human approves later.
 */
export async function runRembgForImage(
  productId: string,
  imageId: string,
  providerId: RemBgProviderId | undefined,
  mode: RembgMode,
): Promise<RembgResult> {
  const supabase = createServiceRoleClient();

  /** Park the row at cutout_failed with the categorized reason.
   *  Centralized so every failure path writes the same shape:
   *  state + last_error_kind together, never one without the other.
   *  Skipped in review mode — the legacy queue UI doesn't read
   *  last_error_kind and we don't want to disturb that flow.
   *
   *  Phase 1 收尾 P0-2: previously the no_provider branch returned
   *  without writing the row, leaving the UI stuck on "Processing…"
   *  forever. Now every error path lands here. */
  async function markFailed(kind: ImageErrorKind) {
    if (mode !== "auto") return;
    await supabase
      .from("product_images")
      .update({ state: "cutout_failed", last_error_kind: kind })
      .eq("id", imageId);
  }

  const { data: row, error: readErr } = await supabase
    .from("product_images")
    .select("raw_image_url")
    .eq("id", imageId)
    .single();
  if (readErr || !row?.raw_image_url) {
    // Don't tag last_error_kind here — missing_raw is a programmer
    // error (caller should never invoke this without a raw_image_url
    // populated), not a categorized end-user failure. Leave the row
    // untouched so the operator sees the row's existing state.
    return { ok: false, error: { kind: "missing_raw" } };
  }

  let signedUrl: string;
  try {
    signedUrl = await getSignedRawUrl(row.raw_image_url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markFailed("provider_error");
    return { ok: false, error: { kind: "rembg", msg } };
  }

  // Size pre-check via HEAD on the signed URL. Replicate downloads
  // the bytes itself, so we'd otherwise pay for a failed call when
  // the file is over its limit. 1.5s timeout — if Storage is slow
  // we let the provider call proceed rather than block the whole
  // pipeline waiting on a HEAD. Failure to determine size is treated
  // as "size OK, try the provider" — better than spurious blocks.
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const head = await fetch(signedUrl, {
      method: "HEAD",
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));
    const len = head.headers.get("content-length");
    if (len) {
      const bytes = Number.parseInt(len, 10);
      if (Number.isFinite(bytes) && bytes > MAX_RAW_BYTES) {
        await markFailed("image_too_large");
        return {
          ok: false,
          error: { kind: "rembg", msg: `image too large: ${bytes} bytes` },
        };
      }
    }
  } catch {
    // Network blip / abort — fall through and let the provider
    // attempt the download. If it fails there we'll catch it below.
  }

  const provider = providerId ? getProvider(providerId) : getDefaultProvider();
  if (!provider) {
    await markFailed("no_provider");
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
          // Clear any prior failure tag — the row is healthy again.
          last_error_kind: null,
        })
        .eq("id", imageId);
      if (updErr) return { ok: false, error: { kind: "db", msg: updErr.message } };
      return { ok: true };
    }

    // AUTO mode: promote to primary iff this product has none yet.
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
      last_error_kind: null;
      is_primary?: boolean;
    } = {
      cutout_image_url: cutoutUrl,
      state: "cutout_approved",
      rembg_provider: result.provider,
      rembg_cost_usd: result.costUsd,
      // Clear any prior failure tag — the row is healthy again.
      last_error_kind: null,
    };
    if (!existingPrimary) patch.is_primary = true;

    const { error: updErr } = await supabase
      .from("product_images")
      .update(patch)
      .eq("id", imageId);
    if (updErr) return { ok: false, error: { kind: "db", msg: updErr.message } };
    return { ok: true };
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      await markFailed("quota_exhausted");
      return { ok: false, error: { kind: "quota", cause: err.cause } };
    }
    if (err instanceof RemBgProviderUnavailableError) {
      await markFailed("no_provider");
      return { ok: false, error: { kind: "no_provider", providerId: err.providerId } };
    }
    const msg = err instanceof Error ? err.message : String(err);
    await markFailed("provider_error");
    return { ok: false, error: { kind: "rembg", msg } };
  }
}

/** Convenience alias — the direct-upload flow always runs in auto. */
export function runRembgAuto(
  productId: string,
  imageId: string,
  providerId?: RemBgProviderId,
): Promise<RembgResult> {
  return runRembgForImage(productId, imageId, providerId, "auto");
}

/** Flatten a RembgError to an err-code / msg pair for ?err=&msg= URLs. */
export function flattenRembgError(
  e: RembgError,
): { code: string; msg: string } {
  switch (e.kind) {
    case "missing_raw":
      return { code: "missing_raw", msg: "raw image missing" };
    case "no_provider":
      return { code: "no_provider", msg: e.providerId ?? "no default provider" };
    case "quota":
      return { code: "quota", msg: e.cause };
    case "rembg":
      return { code: "rembg", msg: e.msg };
    case "db":
      return { code: "db", msg: e.msg };
  }
}
