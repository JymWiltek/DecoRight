"use server";

/**
 * Direct-upload server actions. Small capability-minting + DB-patching
 * endpoints that replace the fat "browser POSTs 47 MB FormData to a
 * server action" path.
 *
 * Flow:
 *   1. Client calls `getSignedUploadUrl(kind, ...)` — we mint a
 *      short-lived signed URL via the service-role key and return it
 *      plus the storage path. Response is tiny (KB).
 *   2. Client PUTs the file bytes directly to Supabase Storage using
 *      that signed URL. Bytes never transit through Vercel — so
 *      Vercel Hobby's 4.5 MB platform body cap is completely
 *      side-stepped.
 *   3a. For images: client calls `attachRawImages(productId, entries)`
 *       to insert product_images rows pointing at the uploaded paths,
 *       then `kickRembgPipeline(productId, imageIds)` to run
 *       background-removal in AUTO mode.
 *   3b. For GLB: client writes the returned storage path into the
 *       product form's hidden `glb_path` input, and the normal Save
 *       flow (products/actions.ts → updateProduct) persists it.
 *
 * Every action here calls requireAdmin() first. They are tiny
 * routes that can be invoked by URL — the /admin middleware doesn't
 * cover server actions.
 */

import { requireAdmin } from "@/lib/auth/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  createSignedRawImageUploadUrl,
  createSignedGlbUploadUrl,
} from "@/lib/storage";
import {
  runRembgForImage,
  flattenRembgError,
} from "@/lib/rembg/pipeline";
import type { RemBgProviderId } from "@/lib/rembg";
import { revalidatePath } from "next/cache";

/**
 * Accepted MIME → file extension. Keeping this tight (no surprise
 * formats) so malformed client code can't wedge a .tiff into the
 * raw-images bucket. Mirrors what UploadDropzone's `accept` attr
 * allows client-side.
 */
const IMAGE_MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export type SignedUploadKind = "raw_image" | "glb";

export type SignedUploadTicket = {
  /** Pre-minted storage-path the client PUTs into. */
  path: string;
  /** Short-lived signed URL that authorizes the PUT. */
  signedUrl: string;
  /** Supabase token (required by `uploadToSignedUrl`); we also include
   *  it so clients using the raw fetch() path can send it via the
   *  `x-upsert` header if they like. */
  token: string;
  /** For raw_image: the pre-generated image-id the client must later
   *  pass to `attachRawImages`. For glb: undefined. */
  imageId?: string;
};

/**
 * Mint a signed URL so the browser can PUT bytes straight into
 * Storage. Admin-gated.
 *
 * For images: we pre-generate a UUID here so the client can upload
 * multiple files in parallel without a race between picking a
 * filename and the DB insert. The same id becomes the product_images
 * PK in `attachRawImages`.
 *
 * For GLB: path is fixed per product (`products/<id>/model.glb`)
 * so a re-upload overwrites the previous model cleanly (upsert=true).
 * One model per product — the id is implicit in the productId arg.
 */
export async function getSignedUploadUrl(
  kind: SignedUploadKind,
  productId: string,
  /** Original filename from the browser — only used to derive the
   *  extension for raw_image; ignored for glb. */
  filename: string,
  /** MIME type from the File object. Only required for raw_image. */
  mime: string,
): Promise<
  | { ok: true; ticket: SignedUploadTicket }
  | { ok: false; error: string }
> {
  await requireAdmin();

  if (!productId || productId.length < 10) {
    return { ok: false, error: "invalid product id" };
  }

  try {
    if (kind === "glb") {
      const ticket = await createSignedGlbUploadUrl(productId);
      return { ok: true, ticket };
    }

    // raw_image: validate MIME, derive extension, mint a fresh
    // product_image id, mint a signed URL.
    const ext =
      IMAGE_MIME_TO_EXT[mime] ??
      // Tolerate a filename-based fallback for the rare browser that
      // reports the empty/wrong MIME (.heic→octet-stream, etc.).
      (filename.toLowerCase().match(/\.(png|jpe?g|webp|gif)$/)?.[1] ?? null);
    if (!ext) {
      return {
        ok: false,
        error: `unsupported image type (${mime || filename})`,
      };
    }
    const normalizedExt = ext === "jpeg" ? "jpg" : ext;
    const imageId = crypto.randomUUID();
    const t = await createSignedRawImageUploadUrl(
      productId,
      imageId,
      normalizedExt,
    );
    return {
      ok: true,
      ticket: {
        path: t.path,
        signedUrl: t.signedUrl,
        token: t.token,
        imageId,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

export type AttachRawImageEntry = {
  /** UUID minted by getSignedUploadUrl and used as the storage filename. */
  imageId: string;
  /** Storage path returned from the signed-URL mint. We re-derive
   *  it server-side from (productId, imageId, ext) instead of
   *  trusting the client blindly. */
  ext: string;
};

/**
 * After the client has successfully PUT each image to Storage, it
 * calls this with the list of ids it uploaded. We insert one
 * product_images row per id in state=raw with raw_image_url set to
 * the storage path. Idempotent: if a row already exists (client
 * retry, network hiccup) we upsert on id.
 */
export async function attachRawImages(
  productId: string,
  entries: AttachRawImageEntry[],
): Promise<{ ok: true; inserted: number } | { ok: false; error: string }> {
  await requireAdmin();

  if (!productId || entries.length === 0) {
    return { ok: false, error: "nothing to attach" };
  }

  const supabase = createServiceRoleClient();
  const rows = entries.map((e) => ({
    id: e.imageId,
    product_id: productId,
    state: "raw" as const,
    raw_image_url: `${productId}/${e.imageId}.${e.ext}`,
  }));

  const { error } = await supabase
    .from("product_images")
    .upsert(rows, { onConflict: "id" });
  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(`/admin/products/${productId}/edit`);
  return { ok: true, inserted: rows.length };
}

export type KickRembgOutcome = {
  imageId: string;
  ok: boolean;
  code?: string;
  msg?: string;
};

/**
 * Run rembg in AUTO mode for a batch of just-uploaded raw rows.
 * Sequential (not parallel) — rembg is quota-metered via advisory
 * lock in reserve_api_slot(), and sequential calls give cleaner
 * api_usage audit rows.
 *
 * Per-image result is returned so the client can show the exact
 * failure (quota / no_provider / rembg) and offer Retry on the
 * cards it parked at cutout_failed.
 */
export async function kickRembgPipeline(
  productId: string,
  imageIds: string[],
  providerId?: RemBgProviderId,
): Promise<{ ok: true; outcomes: KickRembgOutcome[] }> {
  await requireAdmin();

  const outcomes: KickRembgOutcome[] = [];
  for (const imageId of imageIds) {
    const res = await runRembgForImage(productId, imageId, providerId, "auto");
    if (res.ok) {
      outcomes.push({ imageId, ok: true });
    } else {
      const flat = flattenRembgError(res.error);
      outcomes.push({ imageId, ok: false, code: flat.code, msg: flat.msg });
    }
  }

  // Auto-approve already copied cutout URLs into products.thumbnail_url
  // via the DB sync trigger, so public pages need cache drops too.
  revalidatePath(`/admin/products/${productId}/edit`);
  revalidatePath("/admin/cutouts");
  revalidatePath("/admin");
  revalidatePath("/");
  revalidatePath(`/product/${productId}`);

  return { ok: true, outcomes };
}

/**
 * Retry a single cutout_failed or stuck-raw image from anywhere in
 * the admin UI (list page Retry button in particular). Resets the
 * row to state=raw and clears any stale cutout artifacts, then runs
 * rembg AUTO. Returns a JSON outcome so the caller can show toast
 * feedback without a redirect.
 */
export async function retryRembgOne(
  productId: string,
  imageId: string,
  providerId?: RemBgProviderId,
): Promise<{ ok: true } | { ok: false; code: string; msg: string }> {
  await requireAdmin();

  const supabase = createServiceRoleClient();
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
    return { ok: false, code: "db", msg: resetErr.message };
  }

  const res = await runRembgForImage(productId, imageId, providerId, "auto");

  revalidatePath(`/admin/products/${productId}/edit`);
  revalidatePath("/admin/cutouts");
  revalidatePath("/admin");
  revalidatePath("/");
  revalidatePath(`/product/${productId}`);

  if (res.ok) return { ok: true };
  const flat = flattenRembgError(res.error);
  return { ok: false, code: flat.code, msg: flat.msg };
}
