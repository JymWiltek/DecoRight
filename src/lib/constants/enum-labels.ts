import type { PriceTier, ProductStatus } from "./enums";

export const PRICE_TIER_LABELS: Record<PriceTier, string> = {
  economy: "经济",
  mid: "中端",
  premium: "高端",
};

export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = {
  draft: "草稿",
  published: "已上架",
  archived: "归档",
  link_broken: "链接失效",
};
