import type { PriceTier, ProductStatus } from "./enums";

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
