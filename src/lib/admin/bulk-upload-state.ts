import type { DraftCardState } from "@/components/admin/ProductDraftCard";

/**
 * Per-card upload progress for the bulk-create form, split out so the
 * refill invariants (skip already-uploaded files, reuse the productId, rebuild
 * the exact FormData) are unit-testable without the React tree. Pure — no
 * server-only, no network.
 *
 * The productId is minted ONCE per card and reused on every refill, so
 * completing a partially-failed card writes the SAME product row (never a
 * duplicate). Each file's result is remembered here and skipped next time.
 */
export type PhotoResult = { imageId: string; ext: string; type: "product" | "reference" };

export type CardUpload = {
  productId: string;
  /** aligned to card.photos — null = not yet uploaded. */
  photos: (PhotoResult | null)[];
  glbPath: string | null;
  fbxPath: string | null;
  /** aligned to card.textureFiles — true = uploaded. */
  textures: boolean[];
  status: "pending" | "done" | "failed";
};

export function initCardUpload(card: DraftCardState): CardUpload {
  return {
    productId: crypto.randomUUID(),
    photos: card.photos.map(() => null),
    glbPath: null,
    fbxPath: null,
    textures: card.textureFiles.map(() => false),
    status: "pending",
  };
}

/** Files in this card still needing an upload — the "N" in the refill button. */
export function countPendingFiles(card: DraftCardState, up: CardUpload): number {
  let n = up.photos.filter((p) => p == null).length;
  if (card.glbFile && card.glbBudget && !up.glbPath) n++;
  if (card.fbxFile && !up.fbxPath) n++;
  n += up.textures.filter((t) => !t).length;
  return n;
}

/**
 * Assemble the createProductFromUpload FormData from the card's scalars + the
 * already-uploaded file results. Called only once every file is up, so every
 * path field is present. Mirrors the original inline builder exactly — reusing
 * the stored paths means a refill never re-derives or re-uploads a done file.
 */
export function buildCardFd(card: DraftCardState, up: CardUpload): FormData {
  const fd = new FormData();
  if (card.itemType) fd.set("item_type", card.itemType);
  if (card.subtypeSlug) fd.set("subtype_slug", card.subtypeSlug);
  for (const r of card.roomSlugs) fd.append("room_slugs", r);
  const dims = card.realDimensions;
  if (dims.length != null) fd.set("dim_length", String(dims.length));
  if (dims.width != null) fd.set("dim_width", String(dims.width));
  if (dims.height != null) fd.set("dim_height", String(dims.height));
  if (card.supplierIds.length > 0) {
    fd.set(
      "product_suppliers_json",
      JSON.stringify(
        card.supplierIds.map((supplier_id) => ({
          supplier_id,
          price_myr: null,
          stock_status: "in_stock",
          buy_url: null,
          store_address: null,
          is_exclusive: false,
        })),
      ),
    );
  }
  const photos = up.photos.filter((p): p is PhotoResult => p != null);
  const rawEntries = photos
    .filter((p) => p.type === "product")
    .map(({ imageId, ext }) => ({ imageId, ext }));
  const realEntries = photos
    .filter((p) => p.type === "reference")
    .map(({ imageId, ext }) => ({ imageId, ext }));
  if (rawEntries.length) fd.set("raw_image_entries", JSON.stringify(rawEntries));
  if (realEntries.length) fd.set("real_photo_entries", JSON.stringify(realEntries));
  if (card.glbFile && card.glbBudget && up.glbPath) {
    fd.set("glb_path", up.glbPath);
    fd.set("glb_size_kb", String(card.glbBudget.sizeKb));
    fd.set("glb_vertex_count", String(card.glbBudget.vertexCount));
    fd.set("glb_max_texture_dim", String(card.glbBudget.maxTextureDim));
    fd.set("glb_decoded_ram_mb", String(card.glbBudget.decodedRamMb));
  }
  if (card.fbxFile && up.fbxPath) {
    if (card.fbxIsZip) {
      fd.set("fbx_bundle_path", up.fbxPath);
      fd.set("fbx_bundle_size_kb", String(Math.round(card.fbxFile.size / 1024)));
    } else {
      fd.set("fbx_path", up.fbxPath);
      fd.set("fbx_size_kb", String(Math.round(card.fbxFile.size / 1024)));
      if (up.textures.some((t) => t)) fd.set("textures_changed", "1");
    }
  }
  return fd;
}
