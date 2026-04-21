import type { PriceTier, ProductStatus } from "@/lib/constants/enums";

export type Dimensions = {
  length?: number;
  width?: number;
  height?: number;
};

// ─── products ───────────────────────────────────────────────
// Phase 2.5: taxonomy is DB-managed. item_type = single slug,
// rooms/styles/colors/materials = arrays of slugs. All slug
// validity is enforced in the admin UI (pill grid) + server
// action against the live taxonomy tables — NOT by DB CHECKs,
// because operators can add new slugs any time.

export type ProductRow = {
  id: string;
  name: string;
  brand: string | null;
  item_type: string | null;
  rooms: string[];
  styles: string[];
  colors: string[];
  materials: string[];
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
  created_at: string;
  updated_at: string;
};

export type ProductInsert = {
  id?: string;
  name: string;
  brand?: string | null;
  item_type?: string | null;
  rooms?: string[];
  styles?: string[];
  colors?: string[];
  materials?: string[];
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
  created_at?: string;
  updated_at?: string;
};

export type ProductUpdate = Partial<Omit<ProductRow, "id" | "created_at">>;

// ─── taxonomy tables ────────────────────────────────────────

export type TaxonomyRow = {
  slug: string;
  label_zh: string;
  sort_order: number;
  created_at: string;
};

export type ColorRow = TaxonomyRow & { hex: string };

export type TaxonomyInsert = {
  slug: string;
  label_zh: string;
  sort_order?: number;
};

export type ColorInsert = TaxonomyInsert & { hex: string };

export type Database = {
  public: {
    Tables: {
      products: {
        Row: ProductRow;
        Insert: ProductInsert;
        Update: ProductUpdate;
        Relationships: [];
      };
      item_types: {
        Row: TaxonomyRow;
        Insert: TaxonomyInsert;
        Update: Partial<TaxonomyRow>;
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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
};
