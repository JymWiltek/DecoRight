import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * Shared product-save validation. Extracted from the products "use server"
 * actions file so BOTH single-edit (updateProduct) AND the Excel bulk-import
 * can call the exact same rules — the SKU-uniqueness and taxonomy-slug checks
 * can't drift between the two entry points.
 */

/** Valid taxonomy slug sets, for validating operator-supplied values against
 *  what actually exists before writing them. */
export async function loadValidSlugs(): Promise<{
  itemTypes: Set<string>;
  /** item_type slug → set of allowed subtype slugs. (item_type,
   *  subtype) must match together; this map lets us validate the
   *  pair in one lookup. */
  subtypesByItemType: Map<string, Set<string>>;
  rooms: Set<string>;
  styles: Set<string>;
  materials: Set<string>;
  colors: Set<string>;
  regions: Set<string>;
}> {
  const supabase = createServiceRoleClient();
  const [it, sub, rm, st, mt, co, rg] = await Promise.all([
    supabase.from("item_types").select("slug"),
    supabase.from("item_subtypes").select("slug,item_type_slug"),
    supabase.from("rooms").select("slug"),
    supabase.from("styles").select("slug"),
    supabase.from("materials").select("slug"),
    supabase.from("colors").select("slug"),
    supabase.from("regions").select("slug"),
  ]);
  const subtypesByItemType = new Map<string, Set<string>>();
  for (const row of sub.data ?? []) {
    const set = subtypesByItemType.get(row.item_type_slug) ?? new Set<string>();
    set.add(row.slug);
    subtypesByItemType.set(row.item_type_slug, set);
  }
  return {
    itemTypes: new Set((it.data ?? []).map((r) => r.slug)),
    subtypesByItemType,
    rooms: new Set((rm.data ?? []).map((r) => r.slug)),
    styles: new Set((st.data ?? []).map((r) => r.slug)),
    materials: new Set((mt.data ?? []).map((r) => r.slug)),
    colors: new Set((co.data ?? []).map((r) => r.slug)),
    regions: new Set((rg.data ?? []).map((r) => r.slug)),
  };
}

/**
 * PB3-B item 7 — SKU uniqueness. Returns the OTHER product that already uses
 * this SKU (trimmed, case-insensitive), or null if none. Empty / null SKU
 * never collides (many products legitimately have no SKU — ~122 today), so
 * callers skip the check for blank values. Shared by single-edit AND Excel
 * import so the rule can't drift. Read-only; enforcement (block the save)
 * lives at each call site. NOT retroactive — only consulted at save time,
 * never batch-applied to existing rows.
 *
 * Small-catalog approach: fetch id/name/sku and normalize in JS. Precise
 * (trim + case-fold both sides, no ilike wildcard/escape pitfalls) and cheap
 * at a few hundred products.
 */
export async function findSkuCollision(
  sku: string | null | undefined,
  selfId: string | null,
): Promise<{ id: string; name: string; sku_id: string | null } | null> {
  const norm = (sku ?? "").trim().toLowerCase();
  if (!norm) return null;
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from("products")
    .select("id, name, sku_id")
    .not("sku_id", "is", null);
  for (const p of data ?? []) {
    if (selfId && p.id === selfId) continue;
    if (String(p.sku_id ?? "").trim().toLowerCase() === norm) return p;
  }
  return null;
}
