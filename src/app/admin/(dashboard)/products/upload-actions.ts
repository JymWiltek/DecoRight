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

import { after } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  createSignedRawImageUploadUrl,
  createSignedGlbUploadUrl,
  createSignedFbxUploadUrl,
  createSignedTextureUploadUrl,
  createSignedThumbnailUploadUrl,
} from "@/lib/storage";
import {
  runRembgForImage,
  flattenRembgError,
} from "@/lib/rembg/pipeline";
import type { RemBgProviderId } from "@/lib/rembg";
import type { Dimensions } from "@/lib/supabase/types";
import { dispatchGlbCompression } from "@/lib/glb-compression-dispatch";
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

export type SignedUploadKind =
  | "raw_image"
  | "glb"
  | "fbx"
  | "texture"
  | "thumbnail";

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

    if (kind === "fbx") {
      // Wave 9 — FBX original. Path is fixed per product
      // (`products/<id>/model.fbx`), upsert=true. Filename / mime
      // unused: FBX has no registered MIME type, and the dropzone
      // vets the extension client-side before calling.
      const ticket = await createSignedFbxUploadUrl(productId);
      return { ok: true, ticket };
    }

    if (kind === "texture") {
      // Wave 11b — FBX texture map. Unlike glb/fbx (fixed path), the
      // filename MATTERS: the .fbx references its maps by name, so we
      // preserve it under products/<id>/textures/<name>. createSigned…
      // sanitizes for storage safety but keeps the base name + ext.
      if (!filename) {
        return { ok: false, error: "texture upload needs a filename" };
      }
      const ticket = await createSignedTextureUploadUrl(productId, filename);
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
      // Clear the prior failure tag — pipeline.ts will re-tag on the
      // new attempt if it fails again. Leaving the old kind in place
      // would mislead the operator after a successful retry (badge
      // says "image too large" even though the swap-fix worked).
      last_error_kind: null,
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

// ─── Wave 9 — dual-file 3D pipeline server actions ──────────
//
// The three actions below back the new dual-upload UI on the
// product edit page:
//
//   • updateRealDimensions  — operator typed the real product
//     length/width/height in mm. Persists to dimensions_mm JSONB
//     (the same column legacy product specs use); the storefront
//     ModelViewer reads this to rescale AR placement to true size.
//
//   • retryGlbCompression   — operator clicks Retry on a failed
//     row. Resets compression_status back to 'pending', clears
//     compression_error, fires the dispatcher (see lib/
//     glb-compression-dispatch — kept OUT of this "use server" file
//     so it isn't accidentally exposed as a public RPC).
//
//   • getCompressionStatus  — 5 s polling target for the
//     CompressionStatusBanner component. Read-only.

const REAL_DIMENSION_MAX_MM = 10_000; // 10 m hard cap — no real product is larger

function isFiniteIntInRange(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && Number.isInteger(n)
    && n > 0 && n <= REAL_DIMENSION_MAX_MM;
}

export async function updateRealDimensions(
  productId: string,
  dims: Partial<Dimensions> | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();

  if (!productId || productId.length < 10) {
    return { ok: false, error: "invalid product id" };
  }

  let value: Dimensions | null = null;
  if (dims && (dims.length != null || dims.width != null || dims.height != null)) {
    value = {};
    if (dims.length != null) {
      if (!isFiniteIntInRange(dims.length)) {
        return { ok: false, error: "length out of range (1..10000 mm)" };
      }
      value.length = dims.length;
    }
    if (dims.width != null) {
      if (!isFiniteIntInRange(dims.width)) {
        return { ok: false, error: "width out of range (1..10000 mm)" };
      }
      value.width = dims.width;
    }
    if (dims.height != null) {
      if (!isFiniteIntInRange(dims.height)) {
        return { ok: false, error: "height out of range (1..10000 mm)" };
      }
      value.height = dims.height;
    }
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("products")
    .update({ dimensions_mm: value })
    .eq("id", productId);
  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(`/admin/products/${productId}/edit`);
  revalidatePath(`/product/${productId}`);

  return { ok: true };
}

export async function retryGlbCompression(
  productId: string,
): Promise<{ ok: true } | { ok: false; code: string; msg: string }> {
  await requireAdmin();

  if (!productId || productId.length < 10) {
    return { ok: false, code: "invalid_id", msg: "invalid product id" };
  }

  const supabase = createServiceRoleClient();

  const { data: row, error: readErr } = await supabase
    .from("products")
    .select("id, glb_url, compression_status")
    .eq("id", productId)
    .maybeSingle();
  if (readErr) {
    return { ok: false, code: "db", msg: readErr.message };
  }
  if (!row) {
    return { ok: false, code: "not_found", msg: "product not found" };
  }
  if (!row.glb_url) {
    return {
      ok: false,
      code: "no_glb",
      msg: "no .glb to compress — upload one first",
    };
  }

  const { error: resetErr } = await supabase
    .from("products")
    .update({
      compression_status: "pending",
      compression_error: null,
      glb_compressed_url: null,
      glb_compressed_size_kb: null,
    })
    .eq("id", productId);
  if (resetErr) {
    return { ok: false, code: "db", msg: resetErr.message };
  }

  after(() => dispatchGlbCompression(productId));

  revalidatePath(`/admin/products/${productId}/edit`);
  return { ok: true };
}

export type CompressionStatusSnapshot = {
  status: "pending" | "processing" | "done" | "failed" | null;
  error: string | null;
  compressedSizeKb: number | null;
  originalSizeKb: number | null;
};

export async function getCompressionStatus(
  productId: string,
): Promise<
  | { ok: true; snapshot: CompressionStatusSnapshot }
  | { ok: false; error: string }
> {
  await requireAdmin();

  if (!productId || productId.length < 10) {
    return { ok: false, error: "invalid product id" };
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("products")
    .select(
      "compression_status, compression_error, glb_compressed_size_kb, glb_size_kb",
    )
    .eq("id", productId)
    .maybeSingle();
  if (error) {
    return { ok: false, error: error.message };
  }
  if (!data) {
    return { ok: false, error: "product not found" };
  }

  return {
    ok: true,
    snapshot: {
      status: (data.compression_status as CompressionStatusSnapshot["status"]) ?? null,
      error: data.compression_error,
      compressedSizeKb: data.glb_compressed_size_kb,
      originalSizeKb: data.glb_size_kb,
    },
  };
}
