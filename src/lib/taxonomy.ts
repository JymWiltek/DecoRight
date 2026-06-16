import { unstable_cache, updateTag } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import type { Locale } from "@/i18n/config";
import type {
  Database,
  TaxonomyRow,
  ColorRow,
  ItemTypeRow,
  ItemTypeRoomRow,
  ItemSubtypeRow,
  RegionRow,
  RoomRow,
} from "./supabase/types";

/** Cookie-free anon client. Taxonomy tables have public-read RLS, so no
 *  session is needed — and critically, `unstable_cache` forbids `cookies()`
 *  inside its scope. Using a plain anon client avoids that. */
function createAnonClient() {
  const url = process.env.NEXT_PUBLIC_APP_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_APP_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_APP_SUPABASE_URL or NEXT_PUBLIC_APP_SUPABASE_ANON_KEY",
    );
  }
  return createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type Taxonomy = {
  itemTypes: ItemTypeRow[];
  /** Migration 0013: subtypes are shape/style only (pull-out,
   *  sensor, L-shape, …) — no room association. Room lives on
   *  the product row (products.room_slugs[]). */
  itemSubtypes: ItemSubtypeRow[];
  /** Migration 0013: M2M item_type ↔ room. Used to recommend
   *  rooms when the admin picks an item type in the product form,
   *  and to list relevant item types on /room/[slug]. NOT a
   *  constraint on which rooms a product may have. */
  itemTypeRooms: ItemTypeRoomRow[];
  /** Migration 0020: each room can carry an optional cover photo
   *  URL for the redesigned home grid. Falls back to gradient tile
   *  when null. */
  rooms: RoomRow[];
  styles: TaxonomyRow[];
  materials: TaxonomyRow[];
  colors: ColorRow[];
  /** Migration 0011: Malaysian retail regions (13 states + 3 FT). */
  regions: RegionRow[];
};

const TAG = "taxonomy";

export async function loadTaxonomy(): Promise<Taxonomy> {
  return unstable_cache(
    async (): Promise<Taxonomy> => {
      const supabase = createAnonClient();
      // ONE round-trip via the get_taxonomy() RPC (mig 0049) instead of
      // 8 parallel PostgREST queries — on a constrained link the 8-way
      // fan-out serialised to ~29s vs ~5s for the single call. Sort order
      // is baked into the RPC: label_en for itemTypes/itemSubtypes/rooms/
      // styles/materials (A-Z for the English-first /admin operator);
      // sort_order for colors (hue ramp), regions (geographic buckets),
      // and itemTypeRooms (join table). See 0049_get_taxonomy.sql.
      const { data, error } = await supabase.rpc("get_taxonomy");
      const tax = data as Taxonomy | null;
      // Poison guard: NEVER cache an empty/failed taxonomy. A transient
      // fetch failure used to return all-empty arrays which unstable_cache
      // then stored for the full 300s TTL → every /c/* 404'd until the
      // window expired. Throw instead, so nothing is cached and the next
      // request retries.
      if (error || !tax || !Array.isArray(tax.itemTypes) || tax.itemTypes.length === 0) {
        throw new Error(`loadTaxonomy failed: ${error?.message ?? "empty taxonomy"}`);
      }
      return {
        itemTypes: tax.itemTypes,
        itemSubtypes: tax.itemSubtypes ?? [],
        itemTypeRooms: tax.itemTypeRooms ?? [],
        rooms: tax.rooms ?? [],
        styles: tax.styles ?? [],
        materials: tax.materials ?? [],
        colors: tax.colors ?? [],
        regions: tax.regions ?? [],
      };
    },
    // v7 — Mig 0026 standardized 14 ms label strings (audit-driven
    // round 2): style/vintage no longer collides with style/classic
    // ('Klasik' → 'Vintaj'), faucet 'Paip' → 'Pili Air', rug 'Tikar'
    // → 'Permaidani', wardrobe 'Almari' → 'Almari Pakaian', etc.
    // A stale v6 payload would keep serving the old strings for the
    // 5-minute revalidate window after deploy — most user-visible on
    // the filter chips and breadcrumbs of ms visitors. Bumping forces
    // a fresh fetch on first hit post-deploy.
    //
    // v6 — Mig 0025 renumbered rooms.sort_order across all 16 rows
    // (real rooms 1-11, storefront-internal categories 20+, balcony
    // pulled in from 100 → 10). The home grid sorts taxonomy.rooms
    // by sort_order, so a stale v5 payload would keep showing the
    // old "rooms-then-quasi-rooms-then-new-rooms-then-balcony"
    // order for the 5-minute revalidate window after deploy.
    //
    // v5 — mig 0020 added rooms.cover_url. Same reasoning: stale v4
    // payloads would render every room with the typographic fallback.
    // v8 — switched the fetch from 8 parallel queries to the single
    // get_taxonomy() RPC (mig 0049). Same payload shape; bumped to force
    // a clean first fetch through the new path post-deploy.
    ["taxonomy-v8"],
    { tags: [TAG], revalidate: 300 },
  )();
}

/** Lookup: for a given item_type, which rooms are "associated"
 *  with it in the M2M table. Drives the Rooms picker's default /
 *  recommendation when the admin picks an item type. Returns [] if
 *  no item_type or no associations. */
export function roomsForItemType(
  itemTypeSlug: string | null,
  taxonomy: Pick<Taxonomy, "itemTypeRooms">,
): string[] {
  if (!itemTypeSlug) return [];
  return taxonomy.itemTypeRooms
    .filter((r) => r.item_type_slug === itemTypeSlug)
    .map((r) => r.room_slug);
}

/** Call after any insert/update/delete on a taxonomy table.
 *  Uses Next 16's `updateTag` (server-action-only; gives
 *  read-your-own-writes in the same response). */
export function invalidateTaxonomyCache(): void {
  updateTag(TAG);
}

/** Minimal shape for label-bearing taxonomy rows. Accepts TaxonomyRow,
 *  ColorRow, ItemTypeRow, ItemSubtypeRow — anything with the four
 *  label-ish columns. Structural typing saves us a generic parameter. */
type Labelable = {
  slug: string;
  /** Canonical. NOT NULL post-migration 0008. */
  label_en: string;
  label_zh: string | null;
  label_ms: string | null;
};

/** Return the best label for a given locale, with a defensive fallback
 *  chain: requested locale → label_en (always present) → slug.
 *
 *  The slug fallback is belt-and-suspenders: label_en is NOT NULL in
 *  the DB so we should never hit it, but if a migration lands out of
 *  order or a row was created via raw SQL without label_en, we'd
 *  rather render the slug than crash. */
export function labelFor(row: Labelable, locale: Locale): string {
  if (locale === "zh") return row.label_zh ?? row.label_en ?? row.slug;
  if (locale === "ms") return row.label_ms ?? row.label_en ?? row.slug;
  return row.label_en ?? row.slug;
}

/** Quick lookup helpers — map slug → label / hex. */
export function labelMap(
  rows: Labelable[],
  locale: Locale,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) out[r.slug] = labelFor(r, locale);
  return out;
}

export function colorHexMap(rows: ColorRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) out[r.slug] = r.hex;
  return out;
}
