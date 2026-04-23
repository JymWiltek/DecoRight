import type { PriceTier, ProductStatus } from "@/lib/constants/enums";

export type Dimensions = {
  length?: number;
  width?: number;
  height?: number;
};

// ─── products ───────────────────────────────────────────────
// Migration 0003: three-layer taxonomy.
//   - rooms (L1)          → scenes / locations
//   - item_types (L2)     → what the thing IS; each row has a
//                           room_slug that anchors it to exactly
//                           one room, plus an optional
//                           attribute_schema describing extra
//                           fields operators will fill in
//   - item_subtypes (L3)  → optional variant of an item_type
//                           (e.g. tv_cabinet → floating / standing).
//
// The old products.rooms[] column is gone. A product's room is
// inferred from item_types.room_slug, so we never store rooms on
// the product row directly. Filters join via item_type when the
// user picks a room.

export type ProductRow = {
  id: string;
  name: string;
  brand: string | null;
  item_type: string | null;
  subtype_slug: string | null;
  styles: string[];
  colors: string[];
  materials: string[];
  /** Migration 0011: subset of public.regions.slug. Drives the
   *  "Available in: Penang, KL, Selangor" line on the product detail
   *  page. Empty array = available nationally / unspecified. */
  store_locations: string[];
  attributes: Record<string, unknown>;
  dimensions_mm: Dimensions | null;
  weight_kg: number | null;
  price_myr: number | null;
  price_tier: PriceTier | null;
  purchase_url: string | null;
  supplier: string | null;
  description: string | null;
  glb_url: string | null;
  glb_size_kb: number | null;
  thumbnail_url: string | null;
  status: ProductStatus;
  ai_filled_fields: string[];
  link_reported_broken_count: number;
  meshy_job_id: string | null;
  meshy_status: string | null;
  meshy_requested_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ProductInsert = {
  id?: string;
  name: string;
  brand?: string | null;
  item_type?: string | null;
  subtype_slug?: string | null;
  styles?: string[];
  colors?: string[];
  materials?: string[];
  store_locations?: string[];
  attributes?: Record<string, unknown>;
  dimensions_mm?: Dimensions | null;
  weight_kg?: number | null;
  price_myr?: number | null;
  price_tier?: PriceTier | null;
  purchase_url?: string | null;
  supplier?: string | null;
  description?: string | null;
  glb_url?: string | null;
  glb_size_kb?: number | null;
  thumbnail_url?: string | null;
  status?: ProductStatus;
  ai_filled_fields?: string[];
  link_reported_broken_count?: number;
  meshy_job_id?: string | null;
  meshy_status?: string | null;
  meshy_requested_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type ProductUpdate = Partial<Omit<ProductRow, "id" | "created_at">>;

// ─── product_images ─────────────────────────────────────────
// 1:N from products. One row per uploaded photo.
//
// Primary (post-0010) flow is fully automatic:
//   1. uploadRawImages → row inserted (state=raw), raw_image_url set
//   2. runRembgForImage fires in the same server action
//      → on success  : state=cutout_approved, is_primary=true if this
//                      is the product's first approved image (sync
//                      trigger then copies cutout_image_url into
//                      products.thumbnail_url)
//      → on failure  : state=cutout_failed, no primary change — the
//                      UI surfaces Retry buttons (Replicate / Remove.bg)
//                      that reuse raw_image_url without re-upload
//   3. markImageUnsatisfied (× button on approved thumbnails) →
//                      state=user_rejected, clears is_primary, and
//                      auto-promotes the next approved row to primary
//                      (or clears products.thumbnail_url if none left)
//
// Legacy states retained for backward-compat with the /admin/cutouts
// review queue and RemoveBg manual rerun path:
//   cutout_pending   — human-review path (rembg succeeded but op
//                      must approve). New uploads skip this.
//   cutout_rejected  — human rejected the cutout in the legacy queue.

export const IMAGE_STATES = [
  "raw",
  "cutout_pending",
  "cutout_approved",
  "cutout_rejected",
  "cutout_failed",
  "user_rejected",
] as const;
export type ImageState = (typeof IMAGE_STATES)[number];

export type ProductImageRow = {
  id: string;
  product_id: string;
  raw_image_url: string | null;
  cutout_image_url: string | null;
  state: ImageState;
  is_primary: boolean;
  rembg_provider: string | null;
  rembg_cost_usd: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type ProductImageInsert = {
  id?: string;
  product_id: string;
  raw_image_url?: string | null;
  cutout_image_url?: string | null;
  state?: ImageState;
  is_primary?: boolean;
  rembg_provider?: string | null;
  rembg_cost_usd?: number | null;
  sort_order?: number;
};

export type ProductImageUpdate = Partial<
  Omit<ProductImageRow, "id" | "product_id" | "created_at">
>;

// ─── taxonomy tables ────────────────────────────────────────

export type TaxonomyRow = {
  slug: string;
  /** Canonical source-of-truth label. NOT NULL in the DB (migration
   *  0008). Everything else — Chinese, Malay, future locales — is a
   *  translation of this. Shopee / Lazada / Apple follow the same
   *  English-canonical model for regional SaaS. */
  label_en: string;
  /** Translated from label_en by the Auto-translate action
   *  (OpenAI GPT-4o-mini) or manually. Null until first run. */
  label_zh: string | null;
  label_ms: string | null;
  sort_order: number;
  created_at: string;
};

export type ColorRow = TaxonomyRow & { hex: string };

export type ItemTypeRow = TaxonomyRow & {
  room_slug: string | null;
  attribute_schema: AttributeSchemaField[];
};

export type ItemSubtypeRow = {
  slug: string;
  item_type_slug: string;
  /** Migration 0011: subtype-owned room. NOT NULL — every subtype
   *  must anchor itself to exactly one room so the storefront's
   *  three-layer funnel can resolve "/room/X → which products" with
   *  one query regardless of which level of the taxonomy carries
   *  the room. */
  room_slug: string;
  label_en: string;
  label_zh: string | null;
  label_ms: string | null;
  sort_order: number;
  created_at: string;
};

/** Migration 0011 — Malaysian retail regions catalog. Used for the
 *  product detail page's "Available in: …" line and for the admin
 *  product form's region multi-select. The `region` field groups the
 *  16 entries into 5 conventional retail buckets (north / central /
 *  south / east / sabah_sarawak) so the picker can render them in
 *  collapsible sections. */
export type RegionRow = {
  slug: string;
  label_en: string;
  label_zh: string | null;
  label_ms: string | null;
  sort_order: number;
  region: "north" | "central" | "south" | "east" | "sabah_sarawak";
  created_at: string;
};

export type RegionInsert = {
  slug: string;
  label_en: string;
  label_zh?: string | null;
  label_ms?: string | null;
  sort_order?: number;
  region: RegionRow["region"];
};

export type AttributeSchemaField = {
  key: string;
  label_zh: string;
  type: "text" | "number" | "select" | "boolean";
  required?: boolean;
  options?: string[];
  unit?: string;
};

export type TaxonomyInsert = {
  slug: string;
  label_en: string;
  label_zh?: string | null;
  label_ms?: string | null;
  sort_order?: number;
};

export type ColorInsert = TaxonomyInsert & { hex: string };

export type ItemTypeInsert = TaxonomyInsert & {
  room_slug?: string | null;
  attribute_schema?: AttributeSchemaField[];
};

export type ItemSubtypeInsert = {
  slug: string;
  item_type_slug: string;
  room_slug: string;
  label_en: string;
  label_zh?: string | null;
  label_ms?: string | null;
  sort_order?: number;
};

// ─── app_config ─────────────────────────────────────────────
// Single-row-per-key KV table. Values are stored as text and
// parsed by the consumer — cheap, future-proof, and easy for
// an operator to edit in the SQL editor.

export type AppConfigRow = {
  key: string;
  value: string;
  updated_at: string;
};

// ─── api_usage ──────────────────────────────────────────────
// Append-only audit of every paid third-party API call. Rows
// are inserted by reserve_api_slot() inside an advisory-locked
// transaction, so a concurrent batch can't blow past the daily
// cap. `cost_usd` is filled in at reserve time from app_config
// (so we bill eagerly, then refund on failure via a separate
// row with negative cost).

export const API_SERVICES = ["replicate_rembg", "removebg", "meshy"] as const;
export type ApiService = (typeof API_SERVICES)[number];

export type ApiUsageRow = {
  id: string;
  service: ApiService;
  product_id: string | null;
  product_image_id: string | null;
  cost_usd: number;
  status: string | null;
  note: string | null;
  created_at: string;
};

export type ApiUsageInsert = {
  id?: string;
  service: ApiService;
  product_id?: string | null;
  product_image_id?: string | null;
  cost_usd: number;
  status?: string | null;
  note?: string | null;
};

export type Database = {
  public: {
    Tables: {
      products: {
        Row: ProductRow;
        Insert: ProductInsert;
        Update: ProductUpdate;
        Relationships: [];
      };
      product_images: {
        Row: ProductImageRow;
        Insert: ProductImageInsert;
        Update: ProductImageUpdate;
        Relationships: [];
      };
      item_types: {
        Row: ItemTypeRow;
        Insert: ItemTypeInsert;
        Update: Partial<ItemTypeRow>;
        Relationships: [];
      };
      item_subtypes: {
        Row: ItemSubtypeRow;
        Insert: ItemSubtypeInsert;
        Update: Partial<ItemSubtypeRow>;
        Relationships: [];
      };
      rooms: {
        Row: TaxonomyRow;
        Insert: TaxonomyInsert;
        Update: Partial<TaxonomyRow>;
        Relationships: [];
      };
      styles: {
        Row: TaxonomyRow;
        Insert: TaxonomyInsert;
        Update: Partial<TaxonomyRow>;
        Relationships: [];
      };
      materials: {
        Row: TaxonomyRow;
        Insert: TaxonomyInsert;
        Update: Partial<TaxonomyRow>;
        Relationships: [];
      };
      colors: {
        Row: ColorRow;
        Insert: ColorInsert;
        Update: Partial<ColorRow>;
        Relationships: [];
      };
      regions: {
        Row: RegionRow;
        Insert: RegionInsert;
        Update: Partial<RegionRow>;
        Relationships: [];
      };
      app_config: {
        Row: AppConfigRow;
        Insert: { key: string; value: string };
        Update: { value: string };
        Relationships: [];
      };
      api_usage: {
        Row: ApiUsageRow;
        Insert: ApiUsageInsert;
        Update: Partial<ApiUsageRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      reserve_api_slot: {
        Args: {
          p_service: ApiService;
          p_product_id?: string | null;
          p_product_image_id?: string | null;
          p_note?: string | null;
        };
        Returns: { usage_id: string; cost_usd: number }[];
      };
    };
    Enums: Record<string, never>;
  };
};
