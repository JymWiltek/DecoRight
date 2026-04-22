import { createClient } from "./supabase/server";
import type { ProductRow } from "./supabase/types";

export type ProductFilters = {
  itemTypes?: string[];
  /**
   * Post-migration 0003: "rooms" is no longer a product column. A
   * product's room is inferred from its item_type (each item_type
   * has a room_slug). When the user picks room(s), we pre-resolve
   * the matching item_types and AND with any itemTypes picks.
   */
  rooms?: string[];
  styles?: string[];
  colors?: string[];
  materials?: string[];
  minPrice?: number;
  maxPrice?: number;
  q?: string;
  sort?: "latest" | "price_asc" | "price_desc";
};

/**
 * Resolve a list of room slugs → the set of item_type slugs that
 * live in those rooms. Used to turn "picked bedroom+living_room"
 * into an `item_type in (bed_frame, mattress, sofa, ...)` query.
 */
async function itemTypesInRooms(
  roomSlugs: string[],
): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("item_types")
    .select("slug")
    .in("room_slug", roomSlugs);
  if (error) throw error;
  return (data ?? []).map((r) => r.slug);
}

export async function listPublishedProducts(
  filters: ProductFilters = {},
  limit = 60,
): Promise<ProductRow[]> {
  const supabase = await createClient();
  let query = supabase.from("products").select("*").eq("status", "published");

  // Combine room and item_type picks into one `item_type in (...)`
  // filter. Semantics: picked rooms ∪ picked item_types, ANDed.
  let itemTypeSet: Set<string> | null = null;
  if (filters.rooms?.length) {
    const fromRooms = await itemTypesInRooms(filters.rooms);
    itemTypeSet = new Set(fromRooms);
  }
  if (filters.itemTypes?.length) {
    if (itemTypeSet) {
      // Intersection — "bedroom" AND "sofa" returns no products,
      // which is the honest answer (no sofas live in bedroom).
      itemTypeSet = new Set(
        filters.itemTypes.filter((t) => itemTypeSet!.has(t)),
      );
    } else {
      itemTypeSet = new Set(filters.itemTypes);
    }
  }
  if (itemTypeSet) {
    if (itemTypeSet.size === 0) return [];
    query = query.in("item_type", Array.from(itemTypeSet));
  }

  // Array columns: overlap = product matches if ANY of the user's
  // picks is in the product's array. That's the "or" semantics the
  // user described ("选灰色 OR 绿色，这个产品都出现").
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

/**
 * Count published products grouped by item_type. Returns a lookup
 * map keyed by the item_type slug. Used by the 3-layer landing pages
 * to decorate room / item_type tiles with "{N} items".
 *
 * Single query for the whole catalog — cheaper than N queries even
 * at 100+ item_types, and we need all counts at once on the landing
 * and room pages.
 */
export async function publishedCountsByItemType(): Promise<
  Record<string, number>
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("item_type")
    .eq("status", "published");
  if (error) throw error;
  const out: Record<string, number> = {};
  for (const row of data ?? []) {
    const slug = row.item_type;
    if (!slug) continue;
    out[slug] = (out[slug] ?? 0) + 1;
  }
  return out;
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
