// Post-Phase-2.5: most enums moved to DB-managed taxonomy tables
// (item_types, rooms, styles, materials, colors). Fetch those via
// `src/lib/taxonomy.ts` instead.
//
// Only the two tiny, operator-internal enums stay hard-coded here
// because they're structural (lifecycle + price bucket), not domain
// taxonomy the user adds to.

export const PRICE_TIERS = ["economy", "mid", "premium"] as const;
export type PriceTier = (typeof PRICE_TIERS)[number];

export const PRODUCT_STATUSES = [
  "draft",
  "published",
  "archived",
  "link_broken",
] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

// Mig 0048 — supplier system. Structural, operator-internal enums.
export const SUPPLIER_TYPES = [
  "official", // brand official store
  "dealer", // authorised dealer
  "store", // physical retail store
  "marketplace", // online marketplace listing
] as const;
export type SupplierType = (typeof SUPPLIER_TYPES)[number];

export const STOCK_STATUSES = ["in_stock", "order", "discontinued"] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];
