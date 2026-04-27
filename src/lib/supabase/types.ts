import type { PriceTier, ProductStatus } from "@/lib/constants/enums";

export type Dimensions = {
  length?: number;
  width?: number;
  height?: number;
};

// ─── products ───────────────────────────────────────────────
// Migration 0013: three-DIMENSION taxonomy.
//   - rooms          → scenes / locations
//   - item_types     → what the thing IS (shape-agnostic)
//   - item_subtypes  → optional shape/style variant of an item_type
//                      (Faucet → pull-out/sensor/traditional/…)
//
// Room, Item Type, Subtype are orthogonal — a faucet can live in
// Kitchen, Bathroom, AND Balcony simultaneously, and its subtype
// (pull-out, sensor, …) describes shape not scope. The old
// pipeline (item_type.room_slug → derive room) is gone; each
// product picks its own rooms via products.room_slugs[], and
// item_types ↔ rooms is a separate M2M (item_type_rooms) that
// only hints "faucets are usually installed in these rooms" so
// the admin form can recommend.

export type ProductRow = {
  id: string;
  name: string;
  brand: string | null;
  item_type: string | null;
  subtype_slug: string | null;
  /** Migration 0013: multi-room. A product can belong to any
   *  number of rooms; published products must have at least one
   *  (enforced by trigger products_rooms_required). */
  room_slugs: string[];
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
  // ── Meshy / GLB pipeline fields (post-0014) ─────────────────
  // meshy_task_id: Meshy's task id from createMeshyTask. Renamed
  //   from meshy_job_id in 0014 to match Meshy's own vocabulary.
  // meshy_status: lifecycle of the GLB generation.
  //   NULL              → never went through Meshy (e.g. seeded
  //                       row, manual upload, or hasn't been
  //                       Published yet)
  //   'pending'         → reserved but not yet kicked off (unused
  //                       in Phase A — we kick off synchronously)
  //   'generating'      → POST'd to Meshy, polling worker watches
  //                       this row
  //   'succeeded'       → GLB uploaded to our bucket
  //   'failed'          → all retries exhausted (max 3)
  // meshy_attempts: retry counter (0..3). Bumped by the polling
  //   worker on FAILED before re-kickoff.
  // meshy_error: last failure reason — surfaced in admin so the
  //   operator decides whether to swap photos and re-publish.
  // glb_generated_at: timestamp of when the GLB landed in Storage
  //   (whether Meshy-generated or operator-uploaded).
  // glb_source: 'meshy' (auto) | 'manual_upload' (operator hand-
  //   uploaded). Audit trail for "Meshy only runs once".
  meshy_task_id: string | null;
  meshy_status: "pending" | "generating" | "succeeded" | "failed" | null;
  meshy_attempts: number;
  meshy_error: string | null;
  glb_generated_at: string | null;
  glb_source: "meshy" | "manual_upload" | null;
  // Legacy columns from migration 0003 STEP 7 — never written to
  // by current code, kept in the type so a stray select * that
  // catches them still type-checks. Schedule for removal in a
  // future cleanup migration.
  meshy_model_url: string | null;
  meshy_cost_usd: number | null;
  created_at: string;
  updated_at: string;
};

export type ProductInsert = {
  id?: string;
  name: string;
  brand?: string | null;
  item_type?: string | null;
  subtype_slug?: string | null;
  room_slugs?: string[];
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
  meshy_task_id?: string | null;
  meshy_status?: "pending" | "generating" | "succeeded" | "failed" | null;
  meshy_attempts?: number;
  meshy_error?: string | null;
  glb_generated_at?: string | null;
  glb_source?: "meshy" | "manual_upload" | null;
  meshy_model_url?: string | null;
  meshy_cost_usd?: number | null;
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

/** Vocabulary for `product_images.last_error_kind`. Pinned by a CHECK
 *  constraint in migration 0019; expand only via a follow-up migration.
 *
 *   no_provider       — REPLICATE_API_TOKEN / REMOVE_BG_API_KEY missing
 *                       at attempt time. Admin/env issue.
 *   quota_exhausted   — internal api_usage cap (advisory-locked) hit.
 *                       Operator must wait for window reset or raise the
 *                       cap in app_config.
 *   provider_error    — Replicate / Remove.bg returned 5xx, network
 *                       blew up, or any other error inside the provider
 *                       call. Usually transient; retry helps.
 *   image_too_large   — Raw bytes > 8 MB. Rembg providers reject those
 *                       with cryptic errors; we short-circuit before
 *                       burning the API call. */
export const IMAGE_ERROR_KINDS = [
  "no_provider",
  "quota_exhausted",
  "provider_error",
  "image_too_large",
] as const;
export type ImageErrorKind = (typeof IMAGE_ERROR_KINDS)[number];

export type ProductImageRow = {
  id: string;
  product_id: string;
  raw_image_url: string | null;
  cutout_image_url: string | null;
  state: ImageState;
  is_primary: boolean;
  rembg_provider: string | null;
  rembg_cost_usd: number | null;
  /** Populated when state is cutout_failed; cleared on success. See
   *  ImageErrorKind for the closed vocabulary. NULL on a row that has
   *  never been attempted (e.g. just-saved Save-as-Draft uploads). */
  last_error_kind: ImageErrorKind | null;
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
  last_error_kind?: ImageErrorKind | null;
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
  attribute_schema: AttributeSchemaField[];
};

/** Migration 0013 — M2M between item_types and rooms. A single
 *  item_type can be associated with multiple rooms (faucet →
 *  kitchen / bathroom / balcony). Used by the admin form to
 *  recommend rooms when the operator picks an item type, and by
 *  /room/[slug] to surface "which item types are commonly found
 *  here". NOT a constraint on products — a product picks rooms
 *  directly via products.room_slugs[]. */
export type ItemTypeRoomRow = {
  item_type_slug: string;
  room_slug: string;
  sort_order: number;
  created_at: string;
};

export type ItemSubtypeRow = {
  slug: string;
  item_type_slug: string;
  /** Shape/style variant of an item_type — e.g. Faucet →
   *  pull-out / sensor / traditional / wall-mounted. Migration
   *  0013 removed the old room_slug field: subtypes describe
   *  shape only; room is orthogonal and lives on the product. */
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
  attribute_schema?: AttributeSchemaField[];
};

export type ItemTypeRoomInsert = {
  item_type_slug: string;
  room_slug: string;
  sort_order?: number;
};

export type ItemSubtypeInsert = {
  slug: string;
  item_type_slug: string;
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
      item_type_rooms: {
        Row: ItemTypeRoomRow;
        Insert: ItemTypeRoomInsert;
        Update: Partial<ItemTypeRoomRow>;
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
