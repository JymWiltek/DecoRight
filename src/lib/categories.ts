/**
 * Wave 12 — the 7 top-level storefront categories.
 *
 * DecoRight products carry a fine-grained `item_type` (bathtub, toilet,
 * basin, sink, faucet, shower, bathroom_vanity, …). The storefront
 * redesign is category-first: a fixed top nav of 7 bathroom categories,
 * each backed by `/category/[slug]`. We REUSE `item_type` (no new
 * column) — every category rolls up one or more item_type slugs:
 *
 *   basin  ← item_type 'basin' + 'sink'  (kitchen/utility sinks read as
 *            "wash basins" for the bathroom-first nav)
 *   cabinet ← item_type 'bathroom_vanity'
 *   accessory ← reserved (no products yet) — shows an empty state.
 *
 * Non-bathroom item_types (sofa, lighting, flooring, …) are deliberately
 * absent: Wiltek's range is bathroom-first, so they don't appear in the
 * category nav. They remain reachable via direct /item/[slug] links and
 * search.
 *
 * Pure data + helpers (no server-only / framework imports) so the client
 * nav AND server pages share one source of truth. Display labels are
 * localized via the `category` i18n namespace; `labelEn` here is the
 * canonical fallback (alt text, OG, non-localized contexts).
 */

export type CategorySlug =
  | "bathtub"
  | "toilet"
  | "basin"
  | "faucet"
  | "shower"
  | "cabinet"
  | "accessory";

export type Category = {
  slug: CategorySlug;
  /** item_type slugs that roll up into this category (for product
   *  queries: `item_type IN (…)`). */
  itemTypes: string[];
  /** Canonical English label — fallback when i18n isn't in scope. */
  labelEn: string;
};

export const CATEGORIES: Category[] = [
  { slug: "bathtub", itemTypes: ["bathtub"], labelEn: "Bathtubs" },
  { slug: "toilet", itemTypes: ["toilet"], labelEn: "Toilets" },
  { slug: "basin", itemTypes: ["basin", "sink"], labelEn: "Basins" },
  { slug: "faucet", itemTypes: ["faucet"], labelEn: "Faucets" },
  { slug: "shower", itemTypes: ["shower"], labelEn: "Showers" },
  { slug: "cabinet", itemTypes: ["bathroom_vanity"], labelEn: "Vanities" },
  { slug: "accessory", itemTypes: ["accessory"], labelEn: "Accessories" },
];

export const CATEGORY_SLUGS: CategorySlug[] = CATEGORIES.map((c) => c.slug);

const CATEGORY_BY_SLUG = new Map<string, Category>(
  CATEGORIES.map((c) => [c.slug, c]),
);

/** Look up a category by its URL slug. Returns null for unknown slugs
 *  (route handlers should notFound() on null). */
export function getCategory(slug: string): Category | null {
  return CATEGORY_BY_SLUG.get(slug) ?? null;
}

/** item_type slugs to filter on for a category page. Empty array for an
 *  unknown slug. */
export function itemTypesForCategory(slug: string): string[] {
  return CATEGORY_BY_SLUG.get(slug)?.itemTypes ?? [];
}

/** Reverse map: which category does a product's item_type belong to?
 *  Used to label cards + drive "Browse by category". Null when the
 *  item_type isn't part of the 7-category bathroom nav. */
export function categoryForItemType(itemType: string | null | undefined): Category | null {
  if (!itemType) return null;
  return CATEGORIES.find((c) => c.itemTypes.includes(itemType)) ?? null;
}

// ── Sprint 1 — dynamic, full-catalog categories ─────────────────────
//
// The full home catalog drops the hardcoded 7-bathroom rollup in favor
// of "category = item_type": the nav shows every item_type that has
// published products (so it grows automatically as Jym adds sofas,
// lighting, …). /c/[category] keys on the item_type slug directly. The
// legacy CATEGORIES rollup above stays only to power the 301 redirects
// from the old /category/[slug] URLs.

export type ActiveCategory = {
  /** item_type slug — also the /c/[category] route param. */
  slug: string;
  count: number;
  coverUrl: string | null;
  /** subtype slugs under this item_type, for the header mega-menu. */
  subtypeSlugs: string[];
};

/**
 * Build the live category list for the nav / browse-by-type / home from
 * already-loaded taxonomy + counts + covers (all tag-cached by the
 * caller — keeps this a pure function with no DB/locale coupling; the
 * caller resolves labels via labelMap). Only item_types with ≥1
 * published product appear; ordered by stock desc, then slug for a
 * stable nav.
 */
export function buildActiveCategories(
  itemTypes: { slug: string }[],
  counts: Record<string, number>,
  covers: Record<string, string>,
  subtypes: { slug: string; item_type_slug: string }[],
): ActiveCategory[] {
  return itemTypes
    .filter((it) => (counts[it.slug] ?? 0) > 0)
    .map((it) => ({
      slug: it.slug,
      count: counts[it.slug] ?? 0,
      coverUrl: covers[it.slug] ?? null,
      subtypeSlugs: subtypes
        .filter((s) => s.item_type_slug === it.slug)
        .map((s) => s.slug),
    }))
    .sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug));
}
