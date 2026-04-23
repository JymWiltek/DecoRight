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
  rooms: TaxonomyRow[];
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
      const [it, sub, itr, rm, st, mt, co, rg] = await Promise.all([
        supabase.from("item_types").select("*").order("sort_order"),
        supabase.from("item_subtypes").select("*").order("sort_order"),
        supabase.from("item_type_rooms").select("*").order("sort_order"),
        supabase.from("rooms").select("*").order("sort_order"),
        supabase.from("styles").select("*").order("sort_order"),
        supabase.from("materials").select("*").order("sort_order"),
        supabase.from("colors").select("*").order("sort_order"),
        supabase.from("regions").select("*").order("sort_order"),
      ]);
      return {
        itemTypes: it.data ?? [],
        itemSubtypes: sub.data ?? [],
        itemTypeRooms: itr.data ?? [],
        rooms: rm.data ?? [],
        styles: st.data ?? [],
        materials: mt.data ?? [],
        colors: co.data ?? [],
        regions: rg.data ?? [],
      };
    },
    // v3 — Migration 0013 drops deriveRoomSlug, adds
    // itemTypeRooms, removes room_slug from item_types + item_subtypes.
    ["taxonomy-v3"],
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
