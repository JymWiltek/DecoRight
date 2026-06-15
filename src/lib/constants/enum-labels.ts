import type {
  PriceTier,
  ProductStatus,
  SupplierType,
  StockStatus,
} from "./enums";

// Admin-facing labels. /admin is English-only (we don't ship the
// localized public switcher there), so these can stay hardcoded.
// If we later localize admin, move these under src/messages/*.json.
export const PRICE_TIER_LABELS: Record<PriceTier, string> = {
  economy: "Economy",
  mid: "Mid-range",
  premium: "Premium",
};

export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
  link_broken: "Link broken",
};

// Mig 0048 — supplier system. Admin labels + a consumer-facing variant
// for the storefront "Where to buy" type badges.
export const SUPPLIER_TYPE_LABELS: Record<SupplierType, string> = {
  official: "Official store",
  dealer: "Authorised dealer",
  store: "Retail store",
  marketplace: "Marketplace",
};

export const STOCK_STATUS_LABELS: Record<StockStatus, string> = {
  in_stock: "In stock",
  order: "On order",
  discontinued: "Discontinued",
};
