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
