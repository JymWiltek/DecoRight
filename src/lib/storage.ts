import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * Storage buckets (created by migration 0003 STEP 9):
 *   - raw-images   : PRIVATE  — operator uploads, signed-URL reads
 *   - cutouts      : PUBLIC   — rembg output, CDN-cached
 *   - models       : PUBLIC   — Meshy .glb output (Stage B)
 *   - thumbnails   : PUBLIC   — legacy, kept for back-compat
 *
 * Path convention (per user decision):
 *   raw-images/<product_id>/<image_id>.<ext>
 *   cutouts/<product_id>/<image_id>.png
 *   models/<product_id>/<meshy_job_id>.glb
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

// ─── models (public) — Stage B ──────────────────────────────

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
