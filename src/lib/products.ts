import { createClient } from "./supabase/server";
import type { ProductRow } from "./supabase/types";
import type {
  Style,
  PrimaryColor,
  Category,
  ApplicableSpace,
} from "./constants/enums";

export type ProductFilters = {
  category?: Category;
  styles?: Style[];
  colors?: PrimaryColor[];
  spaces?: ApplicableSpace[];
  minPrice?: number;
  maxPrice?: number;
  q?: string;
  sort?: "latest" | "price_asc" | "price_desc";
};

export async function listPublishedProducts(
  filters: ProductFilters = {},
  limit = 60,
): Promise<ProductRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("products")
    .select("*")
    .eq("status", "published");

  if (filters.category) query = query.eq("category", filters.category);
  if (filters.styles?.length) query = query.in("style", filters.styles);
  if (filters.colors?.length) query = query.in("primary_color", filters.colors);
  if (filters.spaces?.length) query = query.overlaps("applicable_space", filters.spaces);
  if (filters.minPrice != null) query = query.gte("price_myr", filters.minPrice);
  if (filters.maxPrice != null) query = query.lte("price_myr", filters.maxPrice);
  if (filters.q) {
    const q = filters.q.trim();
    if (q) {
      query = query.or(
        `name.ilike.%${q}%,description.ilike.%${q}%,brand.ilike.%${q}%`,
      );
    }
  }

  switch (filters.sort) {
    case "price_asc":
      query = query.order("price_myr", { ascending: true, nullsFirst: false });
      break;
    case "price_desc":
      query = query.order("price_myr", { ascending: false, nullsFirst: false });
      break;
    default:
      query = query.order("created_at", { ascending: false });
  }

  const { data, error } = await query.limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function getPublishedProductById(id: string): Promise<ProductRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", id)
    .eq("status", "published")
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getRelatedProducts(product: ProductRow, limit = 6): Promise<ProductRow[]> {
  if (!product.style) return [];
  const supabase = await createClient();
  const colors = Array.from(
    new Set(
      [product.primary_color, "white", "black"].filter(
        (c): c is PrimaryColor => c != null,
      ),
    ),
  );
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("status", "published")
    .eq("style", product.style)
    .in("primary_color", colors)
    .neq("id", product.id)
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}
