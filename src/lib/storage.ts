import { createServiceRoleClient } from "@/lib/supabase/service";

const MODELS_BUCKET = "models";
const THUMBS_BUCKET = "thumbnails";

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

export async function uploadThumbnail(productId: string, file: File): Promise<string> {
  const supabase = createServiceRoleClient();
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
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
