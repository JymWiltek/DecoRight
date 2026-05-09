import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * Storage buckets (created by migration 0003 STEP 9):
 *   - raw-images   : PRIVATE  — operator uploads, signed-URL reads
 *   - cutouts      : PUBLIC   — rembg output, CDN-cached
 *   - models       : PUBLIC   — GLBs (Phase A: Meshy auto + manual
 *                               uploads, both at the same fixed
 *                               path; 60 MB file_size_limit is
 *                               enough for either)
 *   - thumbnails   : PUBLIC   — used by the inline thumbnail-swap
 *                               button on /admin
 *
 * Path convention (per user decision):
 *   raw-images/<product_id>/<image_id>.<ext>
 *   cutouts/<product_id>/<image_id>.png
 *   models/products/<product_id>/model.glb
 *   thumbnails/products/<product_id>/thumbnail.<ext>
 *
 * Note on the GLB path: one GLB per product (NOT keyed by
 * meshy_task_id). Re-runs upsert at the same key so a Meshy retry
 * or a manual hand-upload replaces the old bytes in place. The
 * meshy_task_id is recorded in the products row, not in the path —
 * cleaner cache-busting (?v=Date.now()) and simpler URL stability
 * for any external links to /product/<id>.
 */

const RAW_BUCKET = "raw-images";
const CUTOUTS_BUCKET = "cutouts";
const MODELS_BUCKET = "models";
const THUMBS_BUCKET = "thumbnails";

/**
 * One hour is plenty: Replicate/Remove.bg fetch the URL in the
 * same request cycle, well under a minute. We keep it short so a
 * leaked URL can't be scraped forever.
 */
const SIGNED_URL_TTL_SEC = 60 * 60;

function extFromContentType(ct: string): string {
  if (ct === "image/png") return "png";
  if (ct === "image/webp") return "webp";
  if (ct === "image/gif") return "gif";
  return "jpg";
}

// ─── raw-images (private) ───────────────────────────────────

export async function uploadRawImage(
  productId: string,
  imageId: string,
  file: File,
): Promise<string> {
  const supabase = createServiceRoleClient();
  const ext = extFromContentType(file.type);
  const path = `${productId}/${imageId}.${ext}`;
  const { error } = await supabase.storage
    .from(RAW_BUCKET)
    .upload(path, file, {
      upsert: true,
      contentType: file.type || "image/jpeg",
      cacheControl: "31536000",
    });
  if (error) throw error;
  // We return the storage path (not a URL) because the bucket is
  // private — anyone fetching later needs a signed URL. The DB
  // column `raw_image_url` stores the path string.
  return path;
}

export async function getSignedRawUrl(path: string): Promise<string> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.storage
    .from(RAW_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SEC);
  if (error) throw error;
  return data.signedUrl;
}

// ─── signed upload URLs — direct-to-Storage from the browser ───
//
// Why: Vercel Hobby caps serverless function request bodies at
// 4.5 MB; a 47 MB .glb or a batch of phone photos exceed that and
// the platform drops the POST before Next ever sees it (operator
// sees "This page couldn't load"). Signed upload URLs mint a
// short-lived token that authorizes a PUT straight into Storage,
// so file bytes never transit through our Vercel function.
//
// The server action mints the URL (small KB response), the client
// uploads the file, then calls a second lightweight action to
// attach the final storage path to a DB row. Bypasses the cap
// completely.
//
// URLs are good for 2 hours by default (Supabase fixed); upsert
// semantics default to false, overridden on GLB where the path
// is stable per product (`products/<id>/model.glb`).

export async function createSignedRawImageUploadUrl(
  productId: string,
  imageId: string,
  ext: string,
): Promise<{ signedUrl: string; token: string; path: string }> {
  const supabase = createServiceRoleClient();
  const path = `${productId}/${imageId}.${ext}`;
  const { data, error } = await supabase.storage
    .from(RAW_BUCKET)
    .createSignedUploadUrl(path);
  if (error) throw error;
  return { signedUrl: data.signedUrl, token: data.token, path: data.path };
}

export async function createSignedGlbUploadUrl(
  productId: string,
): Promise<{ signedUrl: string; token: string; path: string }> {
  const supabase = createServiceRoleClient();
  // Same fixed path `uploadGlb` used — one GLB per product, upsert
  // so replacing works without first deleting.
  const path = `products/${productId}/model.glb`;
  const { data, error } = await supabase.storage
    .from(MODELS_BUCKET)
    .createSignedUploadUrl(path, { upsert: true });
  if (error) throw error;
  return { signedUrl: data.signedUrl, token: data.token, path: data.path };
}

/**
 * Mint a signed PUT URL for a product's single thumbnail. One thumbnail
 * per product (path is keyed only by productId + ext), upsert=true so a
 * re-upload overwrites the previous file in place. Used by the inline
 * "swap thumbnail" button on the /admin product list — bypasses the
 * Vercel 4.5 MB body cap by letting the browser PUT direct to Storage.
 *
 * Why ext is part of the path: a JPG and a PNG of the same product would
 * otherwise collide at the same key under different file types. Keeping
 * ext in the filename means a switch from JPG→PNG creates a NEW object
 * (the old JPG lingers in the bucket as orphan bytes — acceptable, and
 * cheaper than a delete-before-upload round-trip).
 */
export async function createSignedThumbnailUploadUrl(
  productId: string,
  ext: string,
): Promise<{ signedUrl: string; token: string; path: string }> {
  const supabase = createServiceRoleClient();
  const path = `products/${productId}/thumbnail.${ext}`;
  const { data, error } = await supabase.storage
    .from(THUMBS_BUCKET)
    .createSignedUploadUrl(path, { upsert: true });
  if (error) throw error;
  return { signedUrl: data.signedUrl, token: data.token, path: data.path };
}

/**
 * Resolve the public URL for a thumbnail at the canonical path. Pairs
 * with `createSignedThumbnailUploadUrl`: after the client direct-PUTs
 * the bytes, the server action calls this to compute the URL it stores
 * in `products.thumbnail_url`.
 *
 * Caller is expected to append `?v=<timestamp>` for cache-busting —
 * THUMBS_BUCKET is public + cache-controlled to 1 year, so without a
 * version query the CDN keeps serving stale bytes for a year after a
 * swap. Same trick `uploadCutout` uses on the cutouts bucket.
 */
export function thumbnailPublicUrl(productId: string, ext: string): string {
  const supabase = createServiceRoleClient();
  const { data } = supabase.storage
    .from(THUMBS_BUCKET)
    .getPublicUrl(`products/${productId}/thumbnail.${ext}`);
  return data.publicUrl;
}

/**
 * Convert a raw-images storage path to its public-facing reference
 * shape (which for the private bucket is just the path — reads go
 * through `getSignedRawUrl`). Kept here so all path-convention
 * knowledge lives in this file.
 */
export function rawImagePath(productId: string, imageId: string, ext: string): string {
  return `${productId}/${imageId}.${ext}`;
}

/**
 * Resolve the public URL for a GLB stored at the canonical path. Used
 * by updateProduct after the client reports a successful direct
 * upload so we can store the final URL (not the storage-path
 * placeholder) in products.glb_url.
 */
export function glbPublicUrl(productId: string): string {
  const supabase = createServiceRoleClient();
  const { data } = supabase.storage
    .from(MODELS_BUCKET)
    .getPublicUrl(`products/${productId}/model.glb`);
  return data.publicUrl;
}

// ─── cutouts (public) ───────────────────────────────────────

export async function uploadCutout(
  productId: string,
  imageId: string,
  bytes: Uint8Array,
): Promise<string> {
  const supabase = createServiceRoleClient();
  const path = `${productId}/${imageId}.png`;
  const { error } = await supabase.storage
    .from(CUTOUTS_BUCKET)
    .upload(
      path,
      // Wrap the Uint8Array in a Blob so supabase-js accepts it in
      // every runtime (Node.js + edge alike).
      new Blob([bytes as BlobPart], { type: "image/png" }),
      {
        upsert: true,
        contentType: "image/png",
        cacheControl: "31536000",
      },
    );
  if (error) throw error;
  const { data } = supabase.storage.from(CUTOUTS_BUCKET).getPublicUrl(path);
  // Append a cache-busting version. The storage path is stable per image,
  // and we upsert on reject-and-rerun — without this query param the CDN
  // / browser would keep serving the OLD bytes for a year (cacheControl
  // above). Using Date.now() guarantees a fresh URL per upload; the bytes
  // live at the same path, the URL we record just carries a new token.
  return `${data.publicUrl}?v=${Date.now()}`;
}

/**
 * Migration 0027 · skip-cutout helper.
 *
 * Copy raw bytes verbatim from the private `raw-images` bucket into
 * the public `cutouts` bucket. Used by `markImageSkipCutout` when the
 * operator declares "this photo is already clean — don't burn rembg
 * quota on it". The row then transitions to state='cutout_approved'
 * with `cutout_image_url` pointing at the public URL returned here, so
 * the existing trigger / RLS / storefront query path doesn't have to
 * special-case skip rows.
 *
 * Why a dedicated helper (vs. reusing `uploadCutout`):
 *   - `uploadCutout` hardcodes `.png` + `contentType: image/png` because
 *     rembg providers always emit PNG-with-alpha. Skip preserves the
 *     operator's original JPG/PNG/WEBP, so the content-type and the
 *     path's extension must match reality (object metadata is what
 *     CDNs and email previewers honor when deciding if the bytes are
 *     a JPEG or a PNG).
 *   - Keeps the rembg-output path semantic ("uploadCutout" = "I have
 *     PNG bytes from rembg") rather than overloading it.
 *
 * Path: cutouts/<productId>/<imageId>.<originalExt>
 *   - Same imageId-keyed convention as `uploadCutout` so the public
 *     URL is stable and upsert idempotent on re-skip.
 *   - We deliberately do NOT collide with the `.png` rembg output
 *     path: if a row is later un-skipped and rerun through rembg, the
 *     rembg run writes to `<imageId>.png` and orphans this `.<ext>`
 *     object. That's acceptable — un-skipping isn't a supported flow,
 *     orphans are cheap, and the alternative (forcing both paths to
 *     the same extension) would require transcoding the JPG to PNG
 *     just to satisfy the path convention.
 */
export async function copyRawToCutouts(
  rawPath: string,
  productId: string,
  imageId: string,
): Promise<string> {
  const supabase = createServiceRoleClient();

  // Download raw bytes. raw_image_url is a storage PATH (the bucket
  // is private, so we never stored a URL — see uploadRawImage). The
  // service-role client bypasses RLS so we don't need a signed URL
  // here — direct .download() is faster than .createSignedUrl + fetch.
  const { data: rawBlob, error: dlErr } = await supabase.storage
    .from(RAW_BUCKET)
    .download(rawPath);
  if (dlErr) throw dlErr;

  // Extract the original extension from the raw path. uploadRawImage
  // uses extFromContentType so legitimate values are png/webp/gif/jpg.
  // Fall back to "jpg" if the path is malformed — a missing/garbage
  // extension shouldn't crash the skip flow; the bytes still display.
  const dotIdx = rawPath.lastIndexOf(".");
  const ext = dotIdx >= 0 ? rawPath.slice(dotIdx + 1).toLowerCase() : "jpg";
  const contentType =
    ext === "png"
      ? "image/png"
      : ext === "webp"
        ? "image/webp"
        : ext === "gif"
          ? "image/gif"
          : "image/jpeg";
  const dstPath = `${productId}/${imageId}.${ext}`;

  // Re-wrap the downloaded Blob with the explicit content-type so
  // Storage records the right object metadata. Supabase-js's upload
  // honors the Blob's `type` AND the `contentType` option; setting
  // both keeps node + edge runtimes consistent.
  const bytes = await rawBlob.arrayBuffer();
  const { error: upErr } = await supabase.storage
    .from(CUTOUTS_BUCKET)
    .upload(dstPath, new Blob([bytes], { type: contentType }), {
      upsert: true,
      contentType,
      cacheControl: "31536000",
    });
  if (upErr) throw upErr;

  const { data } = supabase.storage.from(CUTOUTS_BUCKET).getPublicUrl(dstPath);
  // Same cache-bust trick as uploadCutout: bucket caches 1y, so a
  // re-skip would otherwise serve stale bytes if the operator
  // re-uploaded the raw under the same imageId.
  return `${data.publicUrl}?v=${Date.now()}`;
}

// ─── models (public) — Phase A GLBs ─────────────────────────

/**
 * Server-side upload from a `File` object. Used by the legacy
 * "operator hand-uploads a .glb via the admin form" path. Returns
 * the public URL (no cache-bust here — callers that care append
 * ?v=Date.now() like updateProduct does).
 */
export async function uploadGlb(productId: string, file: File): Promise<string> {
  const supabase = createServiceRoleClient();
  const path = `products/${productId}/model.glb`;
  const { error } = await supabase.storage
    .from(MODELS_BUCKET)
    .upload(path, file, {
      upsert: true,
      contentType: "model/gltf-binary",
      cacheControl: "31536000",
    });
  if (error) throw error;
  const { data } = supabase.storage.from(MODELS_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Server-side upload from raw bytes. The Meshy polling worker
 * (Milestone 3) calls this with the Uint8Array `downloadMeshyGlb`
 * returns — Meshy's CDN URL is short-lived, so we re-host immediately
 * after a task hits SUCCEEDED.
 *
 * Mirrors `uploadCutout`'s shape: wraps the bytes in a Blob (works
 * across Node 18+ and edge runtimes), upserts at the canonical
 * path, returns the public URL with a `?v=<timestamp>` cache-bust
 * (the bucket sets cacheControl=1y, and a Meshy retry would otherwise
 * keep serving stale bytes from CDN edges for that full year).
 *
 * Why not reuse uploadGlb(file): callers in worker-land have raw
 * bytes from a fetch(), not a `File`. Forcing them to wrap in
 * `new File([bytes], ...)` works in some runtimes but trips on
 * older Node where File isn't global. A typed bytes overload is
 * less surprising.
 */
export async function uploadGlbBytes(
  productId: string,
  bytes: Uint8Array,
): Promise<string> {
  const supabase = createServiceRoleClient();
  const path = `products/${productId}/model.glb`;
  const { error } = await supabase.storage
    .from(MODELS_BUCKET)
    .upload(
      path,
      new Blob([bytes as BlobPart], { type: "model/gltf-binary" }),
      {
        upsert: true,
        contentType: "model/gltf-binary",
        cacheControl: "31536000",
      },
    );
  if (error) throw error;
  const { data } = supabase.storage.from(MODELS_BUCKET).getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

// ─── thumbnails (legacy, still used by manual upload) ───────

export async function uploadThumbnail(productId: string, file: File): Promise<string> {
  const supabase = createServiceRoleClient();
  const ext = extFromContentType(file.type);
  const path = `products/${productId}/thumbnail.${ext}`;
  const { error } = await supabase.storage
    .from(THUMBS_BUCKET)
    .upload(path, file, {
      upsert: true,
      contentType: file.type,
      cacheControl: "31536000",
    });
  if (error) throw error;
  const { data } = supabase.storage.from(THUMBS_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Wave 2 — write a unified PNG to thumbnails/products/<id>/unified.png.
 * Same bucket, separate filename so the existing uploadThumbnail()
 * (manual upload) can coexist on its own filename without collision.
 *
 * Caller is expected to append `?v=<timestamp>` for cache-busting on
 * subsequent re-unifies; THUMBS_BUCKET is public with 1-year
 * Cache-Control, same as the cutouts bucket.
 */
export async function uploadUnifiedThumbnailPng(
  productId: string,
  bytes: Uint8Array,
): Promise<string> {
  const supabase = createServiceRoleClient();
  const path = `products/${productId}/unified.png`;
  const { error } = await supabase.storage
    .from(THUMBS_BUCKET)
    .upload(
      path,
      // Wrap in Blob so supabase-js accepts the buffer in every runtime.
      new Blob([bytes as BlobPart], { type: "image/png" }),
      {
        upsert: true,
        contentType: "image/png",
        cacheControl: "31536000",
      },
    );
  if (error) throw error;
  const { data } = supabase.storage.from(THUMBS_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
