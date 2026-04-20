export const STYLES = [
  "modern",
  "minimalist",
  "scandinavian",
  "japanese",
  "industrial",
  "luxury",
  "vintage",
  "mediterranean",
  "classic",
] as const;
export type Style = (typeof STYLES)[number];

export const PRIMARY_COLORS = [
  "white",
  "black",
  "grey",
  "silver",
  "gold",
  "rose_gold",
  "copper",
  "brass",
  "chrome",
  "wood_light",
  "wood_dark",
  "beige",
  "brown",
  "blue",
  "green",
] as const;
export type PrimaryColor = (typeof PRIMARY_COLORS)[number];

export const MATERIALS = [
  "stainless_steel",
  "brass",
  "chrome_plated",
  "ceramic",
  "porcelain",
  "glass",
  "marble",
  "granite",
  "solid_wood",
  "engineered_wood",
  "fabric",
  "leather",
  "plastic",
  "zinc_alloy",
] as const;
export type Material = (typeof MATERIALS)[number];

export const INSTALLATIONS = [
  "wall_mounted",
  "floor_standing",
  "countertop",
  "undermount",
  "freestanding",
  "built_in",
  "ceiling_mounted",
  "pendant",
] as const;
export type Installation = (typeof INSTALLATIONS)[number];

export const APPLICABLE_SPACES = [
  "master_bathroom",
  "guest_bathroom",
  "kitchen",
  "living_room",
  "dining_room",
  "master_bedroom",
  "secondary_bedroom",
  "study",
  "balcony",
  "entrance",
  "laundry",
] as const;
export type ApplicableSpace = (typeof APPLICABLE_SPACES)[number];

export const CATEGORIES = [
  "bathroom",
  "kitchen",
  "lighting",
  "furniture",
  "decor",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const PRICE_TIERS = ["economy", "mid", "premium"] as const;
export type PriceTier = (typeof PRICE_TIERS)[number];

export const PRODUCT_STATUSES = [
  "draft",
  "published",
  "archived",
  "link_broken",
] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];
