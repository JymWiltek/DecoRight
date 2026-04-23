import { unstable_cache, updateTag } from "next/cache";
import { createClient as createAnonSbClient } from "@supabase/supabase-js";
import { createClient } from "./supabase/server";
import type { Database, ProductRow } from "./supabase/types";

export type ProductFilters = {
  itemTypes?: string[];
  /**
   * Migration 0013: room is now a product column (products.room_slugs
   * text[]). A product matches room X if any entry in its room_slugs
   * equals X — one .overlaps() call, no pre-resolution needed.
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

export async function listPublishedProducts(
  filters: ProductFilters = {},
  limit = 60,
): Promise<ProductRow[]> {
  const supabase = await createClient();
  let query = supabase.from("products").select("*").eq("status", "published");

  // Room filter — products.room_slugs overlaps the user's picks.
  // "Kitchen OR Balcony" = match any product whose room_slugs array
  // contains either. That's `overlaps` (PostgREST `ov`).
  if (filters.rooms?.length) {
    query = query.overlaps("room_slugs", filters.rooms);
  }
  if (filters.itemTypes?.length) {
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

/**
 * Count published products by item_type within a specific room.
 * Used by /room/[slug] to show "kitchen has 4 faucets, 2 sinks"
 * rather than global item_type counts (which would mislead —
 * /room/kitchen and /room/bathroom shouldn't show the same number
 * for "faucet" when most faucets are kitchen-only).
 *
 * One query per room-page visit, filtered server-side with
 * `overlaps` on room_slugs. Cached per-room for 5 min on the tag.
 */
export async function publishedCountsByItemTypeInRoom(
  roomSlug: string,
): Promise<Record<string, number>> {
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
        .eq("status", "published")
        .overlaps("room_slugs", [roomSlug]);
      if (error) throw error;
      const out: Record<string, number> = {};
      for (const row of data ?? []) {
        const slug = row.item_type;
        if (!slug) continue;
        out[slug] = (out[slug] ?? 0) + 1;
      }
      return out;
    },
    ["published-counts-by-item-type-in-room-v1", roomSlug],
    { tags: [PRODUCT_COUNTS_TAG], revalidate: 300 },
  )();
}

/**
 * Count published products grouped by room_slug. A product in
 * ["kitchen", "bathroom"] counts once in each — so these numbers
 * add up to MORE than the total product count (intentional: each
 * room tile shows "things that go here", not an exclusive partition).
 *
 * Uses the same cache tag + anon client as `publishedCountsByItemType`
 * so a single invalidation after publish refreshes both at once.
 */
export async function publishedCountsByRoom(): Promise<
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
        .select("room_slugs")
        .eq("status", "published");
      if (error) throw error;
      const out: Record<string, number> = {};
      for (const row of data ?? []) {
        for (const slug of row.room_slugs ?? []) {
          if (!slug) continue;
          out[slug] = (out[slug] ?? 0) + 1;
        }
      }
      return out;
    },
    ["published-counts-by-room-v1"],
    { tags: [PRODUCT_COUNTS_TAG], revalidate: 300 },
  )();
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
