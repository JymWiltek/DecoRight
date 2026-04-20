import type {
  Style,
  PrimaryColor,
  Material,
  Installation,
  ApplicableSpace,
  Category,
  PriceTier,
  ProductStatus,
} from "@/lib/constants/enums";

export type ColorVariant = {
  name: string;
  hex: string;
  price_adjustment_myr: number;
  purchase_url_override: string | null;
};

export type Dimensions = {
  length?: number;
  width?: number;
  height?: number;
};

export type ProductRow = {
  id: string;
  name: string;
  brand: string | null;
  category: Category;
  subcategory: string | null;
  style: Style | null;
  primary_color: PrimaryColor | null;
  material: Material | null;
  installation: Installation | null;
  applicable_space: ApplicableSpace[];
  dimensions_mm: Dimensions | null;
  weight_kg: number | null;
  price_myr: number | null;
  price_tier: PriceTier | null;
  color_variants: ColorVariant[];
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

export type ProductInsert = Omit<
  ProductRow,
  "id" | "created_at" | "updated_at" | "applicable_space" | "color_variants" | "ai_filled_fields" | "link_reported_broken_count" | "status"
> & {
  id?: string;
  status?: ProductStatus;
  applicable_space?: ApplicableSpace[];
  color_variants?: ColorVariant[];
  ai_filled_fields?: string[];
  link_reported_broken_count?: number;
  created_at?: string;
  updated_at?: string;
};

export type ProductUpdate = Partial<Omit<ProductRow, "id" | "created_at">>;

export type Database = {
  public: {
    Tables: {
      products: {
        Row: ProductRow;
        Insert: ProductInsert;
        Update: ProductUpdate;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
};
