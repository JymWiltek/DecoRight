import type {
  Style,
  PrimaryColor,
  Material,
  Installation,
  ApplicableSpace,
  Category,
  PriceTier,
} from "./enums";

export const STYLE_LABELS: Record<Style, string> = {
  modern: "现代",
  minimalist: "极简",
  scandinavian: "北欧",
  japanese: "日式",
  industrial: "工业",
  luxury: "轻奢",
  vintage: "复古",
  mediterranean: "地中海",
  classic: "古典",
};

export const PRIMARY_COLOR_LABELS: Record<PrimaryColor, string> = {
  white: "白色",
  black: "黑色",
  grey: "灰色",
  silver: "银色",
  gold: "金色",
  rose_gold: "玫瑰金",
  copper: "铜色",
  brass: "黄铜",
  chrome: "铬色",
  wood_light: "浅木色",
  wood_dark: "深木色",
  beige: "米色",
  brown: "棕色",
  blue: "蓝色",
  green: "绿色",
};

export const PRIMARY_COLOR_HEX: Record<PrimaryColor, string> = {
  white: "#FFFFFF",
  black: "#1C1C1C",
  grey: "#8E8E93",
  silver: "#C0C0C0",
  gold: "#D4AF37",
  rose_gold: "#B76E79",
  copper: "#B87333",
  brass: "#B5A642",
  chrome: "#C4C4C4",
  wood_light: "#D8B894",
  wood_dark: "#5D4037",
  beige: "#E8DCC4",
  brown: "#6F4E37",
  blue: "#3B5998",
  green: "#5A7A52",
};

export const MATERIAL_LABELS: Record<Material, string> = {
  stainless_steel: "不锈钢",
  brass: "黄铜",
  chrome_plated: "镀铬",
  ceramic: "陶瓷",
  porcelain: "瓷",
  glass: "玻璃",
  marble: "大理石",
  granite: "花岗岩",
  solid_wood: "实木",
  engineered_wood: "复合木",
  fabric: "布艺",
  leather: "皮革",
  plastic: "塑料",
  zinc_alloy: "锌合金",
};

export const INSTALLATION_LABELS: Record<Installation, string> = {
  wall_mounted: "壁挂",
  floor_standing: "落地",
  countertop: "台面",
  undermount: "台下",
  freestanding: "独立",
  built_in: "嵌入",
  ceiling_mounted: "吸顶",
  pendant: "吊装",
};

export const APPLICABLE_SPACE_LABELS: Record<ApplicableSpace, string> = {
  master_bathroom: "主卫",
  guest_bathroom: "客卫",
  kitchen: "厨房",
  living_room: "客厅",
  dining_room: "餐厅",
  master_bedroom: "主卧",
  secondary_bedroom: "次卧",
  study: "书房",
  balcony: "阳台",
  entrance: "玄关",
  laundry: "洗衣间",
};

export const CATEGORY_LABELS: Record<Category, string> = {
  bathroom: "卫浴",
  kitchen: "厨房",
  lighting: "灯具",
  furniture: "家具",
  decor: "装饰",
};

export const PRICE_TIER_LABELS: Record<PriceTier, string> = {
  economy: "经济",
  mid: "中端",
  premium: "高端",
};
