import { unstable_cache, updateTag } from "next/cache";
import { createClient as createAnonSbClient } from "@supabase/supabase-js";
import { createClient } from "./supabase/server";
import type { Database, ProductRow } from "./supabase/types";

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
 * Resolve a list of room slugs → both the item_type slugs whose
 * room_slug matches AND the (item_type, subtype) pairs of subtypes
 * whose room_slug matches. Migration 0011 made room derivation
 * subtype-aware, so we mirror that here: a "bedroom" pick should
 * surface a floating-TV-cabinet (item_type=tv_cabinet/room=living_room
 * but subtype=floating/room=bedroom) AND a regular bed_frame.
 */
async function itemTypesAndSubtypesInRooms(
  roomSlugs: string[],
): Promise<{
  /** item_types whose own room_slug matches — a product with NO
   *  subtype that picks one of these item_types belongs to the room. */
  itemTypeSlugs: string[];
  /** Subtype-owned matches: a product whose (item_type, subtype) pair
   *  is in this list ALSO belongs to the room. */
  subtypePairs: { itemType: string; subtype: string }[];
}> {
  const supabase = await createClient();
  const [itResp, subResp] = await Promise.all([
    supabase.from("item_types").select("slug").in("room_slug", roomSlugs),
    supabase
      .from("item_subtypes")
      .select("slug,item_type_slug")
      .in("room_slug", roomSlugs),
  ]);
  if (itResp.error) throw itResp.error;
  if (subResp.error) throw subResp.error;
  return {
    itemTypeSlugs: (itResp.data ?? []).map((r) => r.slug),
    subtypePairs: (subResp.data ?? []).map((r) => ({
      itemType: r.item_type_slug,
      subtype: r.slug,
    })),
  };
}

export async function listPublishedProducts(
  filters: ProductFilters = {},
  limit = 60,
): Promise<ProductRow[]> {
  const supabase = await createClient();
  let query = supabase.from("products").select("*").eq("status", "published");

  // ── Room filter (subtype-aware) ─────────────────────────────
  // A product belongs to the picked room(s) if EITHER:
  //   (a) it picked an item_type whose room_slug matches AND it has
  //       no subtype, OR
  //   (b) it picked a (item_type, subtype) pair where the subtype's
  //       room_slug matches.
  // We translate this to a PostgREST `or(...)` of two `and(...)`
  // groups. If the user also picked specific item_types we intersect
  // with those.
  if (filters.rooms?.length) {
    const { itemTypeSlugs, subtypePairs } =
      await itemTypesAndSubtypesInRooms(filters.rooms);

    let allowedItemTypes = itemTypeSlugs;
    let allowedSubtypePairs = subtypePairs;
    if (filters.itemTypes?.length) {
      const picked = new Set(filters.itemTypes);
      allowedItemTypes = allowedItemTypes.filter((t) => picked.has(t));
      allowedSubtypePairs = allowedSubtypePairs.filter((p) =>
        picked.has(p.itemType),
      );
    }

    if (allowedItemTypes.length === 0 && allowedSubtypePairs.length === 0) {
      return [];
    }

    const orParts: string[] = [];
    if (allowedItemTypes.length > 0) {
      // (subtype_slug is null AND item_type IN (...))
      orParts.push(
        `and(subtype_slug.is.null,item_type.in.(${allowedItemTypes
          .map((s) => s.replace(/[(),]/g, ""))
          .join(",")}))`,
      );
    }
    for (const p of allowedSubtypePairs) {
      // PostgREST disallows commas/parens in identifiers within or(),
      // and our slugs are [a-z0-9_] so no escaping needed in practice.
      orParts.push(
        `and(item_type.eq.${p.itemType},subtype_slug.eq.${p.subtype})`,
      );
    }
    query = query.or(orParts.join(","));
  } else if (filters.itemTypes?.length) {
    // No room filter — straight item_type IN (...)
    query = query.in("item_type", filters.itemTypes);
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
 *
 * Cached for 5 minutes on a cookieless anon client. The cookie-aware
 * server client would opt the calling page into dynamic rendering
 * (any read of `cookies()` does), which disabled bf-cache on `/` and
 * `/room/*`. Published-product counts are public data — no session
 * required — so a plain anon client is correct. Tag matches
 * `loadTaxonomy` so any write that invalidates taxonomy also
 * invalidates counts (new products publish → item_type counts shift).
 */
const PRODUCT_COUNTS_TAG = "published-counts";

export async function publishedCountsByItemType(): Promise<
  Record<string, number>
> {
  return unstable_cache(
    async () => {
      const url = process.env.NEXT_PUBLIC_APP_SUPABASE_URL;
      const anonKey = process.env.NEXT_PUBLIC_APP_SUPABASE_ANON_KEY;
      if (!url || !anonKey) {
        throw new Error(
          "Missing NEXT_PUBLIC_APP_SUPABASE_URL or NEXT_PUBLIC_APP_SUPABASE_ANON_KEY",
        );
      }
      const supabase = createAnonSbClient<Database>(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
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
    },
    ["published-counts-v1"],
    { tags: [PRODUCT_COUNTS_TAG], revalidate: 300 },
  )();
}

/** Invalidate after publish/unpublish/insert so the home + room
 *  pages reflect the new count on next request. */
export function invalidatePublishedCountsCache(): void {
  updateTag(PRODUCT_COUNTS_TAG);
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
