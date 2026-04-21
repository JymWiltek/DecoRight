import { createClient } from "./supabase/server";
import type { ProductRow } from "./supabase/types";

export type ProductFilters = {
  itemTypes?: string[];
  rooms?: string[];
  styles?: string[];
  colors?: string[];
  materials?: string[];
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
  let query = supabase.from("products").select("*").eq("status", "published");

  // item_type: single column, OR-match any picked slug
  if (filters.itemTypes?.length) query = query.in("item_type", filters.itemTypes);

  // array columns: overlap = product matches if ANY of the user's
  // picks is in the product's array. That's the "or" semantics the
  // user described ("选灰色 OR 绿色，这个产品都出现").
  if (filters.rooms?.length) query = query.overlaps("rooms", filters.rooms);
  if (filters.styles?.length) query = query.overlaps("styles", filters.styles);
  if (filters.colors?.length) query = query.overlaps("colors", filters.colors);
  if (filters.materials?.length)
    query = query.overlaps("materials", filters.materials);

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

export async function getRelatedProducts(
  product: ProductRow,
  limit = 6,
): Promise<ProductRow[]> {
  // Related = same item_type, excluding self, published.
  // If no item_type on this product, fall back to matching on styles overlap.
  const supabase = await createClient();
  let query = supabase
    .from("products")
    .select("*")
    .eq("status", "published")
    .neq("id", product.id);

  if (product.item_type) {
    query = query.eq("item_type", product.item_type);
  } else if (product.styles.length > 0) {
    query = query.overlaps("styles", product.styles);
  } else {
    return [];
  }

  const { data, error } = await query.limit(limit);
  if (error) throw error;
  return data ?? [];
}
