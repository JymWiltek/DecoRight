"use server";

/**
 * Client-callable server actions for the staged-upload flow.
 *
 * The two actions here are:
 *
 *   1. `getSignedUploadUrl(kind, productId, filename, mime)`
 *      Mints a short-lived Supabase Storage signed URL + returns
 *      the storage path. The browser then PUTs bytes directly to
 *      that URL, completely bypassing Vercel's 4.5 MB platform
 *      body cap. Used by both the image dropzone and the GLB
 *      dropzone.
 *
 *   2. `retryRembgOne(productId, imageId, providerId?)`
 *      One-shot rembg re-run for a single image. Used from the
 *      "Retry rembg" chip on the /admin list for images stuck at
 *      state='raw' / 'cutout_failed' — e.g. rows inserted by a
 *      Save-as-Draft where the operator later decides they want
 *      to process just one image without publishing the whole
 *      product.
 *
 * Earlier iterations exported `attachRawImages` + `kickRembgPipeline`
 * as separate endpoints the client dropzone orchestrated after
 * each PUT. That path was removed when we moved to "commit on Save":
 * attach + rembg now happen *inside* createProduct / updateProduct
 * after the product metadata write, so there's one atomic commit
 * point. See products/actions.ts `parseRawImageEntries` +
 * `processPendingImagesForPublish` for the current home of that
 * logic.
 *
 * Every action here calls `requireAdmin()` first — server actions
 * are URL-addressable and the /admin middleware doesn't cover them.
 */

import { requireAdmin } from "@/lib/auth/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  createSignedRawImageUploadUrl,
  createSignedGlbUploadUrl,
  createSignedThumbnailUploadUrl,
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

export type SignedUploadKind = "raw_image" | "glb" | "thumbnail";

export type SignedUploadTicket = {
  /** Pre-minted storage-path the client PUTs into. */
  path: string;
  /** Short-lived signed URL that authorizes the PUT. */
  signedUrl: string;
  /** Supabase token (required by `uploadToSignedUrl`); we also include
   *  it so clients using the raw fetch() path can send it via the
   *  `x-upsert` header if they like. */
  token: string;
  /** For raw_image: the pre-generated image-id the client later sends
   *  back to the Save server action as part of `raw_image_entries`.
   *  For glb / thumbnail: undefined (the storage path IS the identifier —
   *  one GLB / one thumbnail per product, fixed path). */
  imageId?: string;
  /** For thumbnail: the validated extension the client used. The
   *  follow-up server action `setProductThumbnail` needs it to
   *  reconstruct the public URL stored in products.thumbnail_url.
   *  Undefined for raw_image / glb. */
  ext?: string;
};

/**
 * Mint a signed URL so the browser can PUT bytes straight into
 * Storage. Admin-gated.
 *
 * For raw_image: we pre-generate a UUID here so the client can upload
 * multiple files in parallel without a race between picking a
 * filename and the DB insert. The same id becomes the product_images
 * PK when the Save server action inserts the row.
 *
 * For glb: path is fixed per product (`products/<id>/model.glb`)
 * so a re-upload overwrites the previous model cleanly (upsert=true).
 * One model per product — the id is implicit in the productId arg.
 *
 * For thumbnail: similar to glb — fixed path per product
 * (`products/<id>/thumbnail.<ext>`), upsert=true, so the inline
 * "swap thumbnail" button on the /admin product list can replace
 * an existing thumbnail with one direct PUT. The returned ticket
 * carries `ext` (not `imageId`) so the follow-up `setProductThumbnail`
 * action can reconstruct the public URL.
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

    // raw_image / thumbnail: both go through the same MIME→ext gate
    // (centralized in IMAGE_MIME_TO_EXT). Splitting only after the
    // validation keeps the malformed-input rejection identical for
    // both paths — a non-image file is rejected here with the same
    // error message regardless of which dropzone called us.
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

    if (kind === "thumbnail") {
      const t = await createSignedThumbnailUploadUrl(productId, normalizedExt);
      return {
        ok: true,
        ticket: {
          path: t.path,
          signedUrl: t.signedUrl,
          token: t.token,
          // Caller needs `ext` to call setProductThumbnail next.
          ext: normalizedExt,
        },
      };
    }

    // raw_image: mint a fresh product_image id, mint a signed URL.
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

/**
 * Retry a single cutout_failed or stuck-raw image from anywhere in
 * the admin UI (list page Retry button in particular, plus the
 * "individual retry" use case on a draft product where the operator
 * wants to process one image without publishing the whole product).
 * Resets the row to state=raw and clears any stale cutout artifacts,
 * then runs rembg AUTO. Returns a JSON outcome so the caller can
 * show toast feedback without a redirect.
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
