import { unstable_cache, updateTag } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import type { Locale } from "@/i18n/config";
import type {
  Database,
  TaxonomyRow,
  ColorRow,
  ItemTypeRow,
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
  rooms: TaxonomyRow[];
  styles: TaxonomyRow[];
  materials: TaxonomyRow[];
  colors: ColorRow[];
};

const TAG = "taxonomy";

export async function loadTaxonomy(): Promise<Taxonomy> {
  return unstable_cache(
    async (): Promise<Taxonomy> => {
      const supabase = createAnonClient();
      const [it, rm, st, mt, co] = await Promise.all([
        supabase.from("item_types").select("*").order("sort_order"),
        supabase.from("rooms").select("*").order("sort_order"),
        supabase.from("styles").select("*").order("sort_order"),
        supabase.from("materials").select("*").order("sort_order"),
        supabase.from("colors").select("*").order("sort_order"),
      ]);
      return {
        itemTypes: it.data ?? [],
        rooms: rm.data ?? [],
        styles: st.data ?? [],
        materials: mt.data ?? [],
        colors: co.data ?? [],
      };
    },
    ["taxonomy-v1"],
    { tags: [TAG], revalidate: 300 },
  )();
}

/** Call after any insert/update/delete on a taxonomy table.
 *  Uses Next 16's `updateTag` (server-action-only; gives
 *  read-your-own-writes in the same response). */
export function invalidateTaxonomyCache(): void {
  updateTag(TAG);
}

/** Minimal shape for label-bearing taxonomy rows. Accepts TaxonomyRow,
 *  ColorRow, ItemTypeRow, ItemSubtypeRow — anything with the three
 *  label columns. Structural typing saves us a generic parameter. */
type Labelable = { label_zh: string; label_en: string | null; label_ms: string | null };

/** Return the best label for a given locale, falling back to label_zh
 *  when the locale column is null. `label_zh` is NOT NULL in the DB, so
 *  this never returns undefined. */
export function labelFor(row: Labelable, locale: Locale): string {
  if (locale === "en") return row.label_en ?? row.label_zh;
  if (locale === "ms") return row.label_ms ?? row.label_zh;
  return row.label_zh;
}

/** Quick lookup helpers — map slug → label / hex. */
export function labelMap(
  rows: (Labelable & { slug: string })[],
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
