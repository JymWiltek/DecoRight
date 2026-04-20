/**
 * Seed 3 permanent test products for Phase 1 dev/demo.
 * Idempotent: re-run to refresh. Keyed by fixed UUIDs.
 *
 * The .glb URLs point to Google's public <model-viewer> sample assets —
 * placeholder only. Phase 3 replaces with real Wiltek products via Meshy.
 *
 * Run: `npm run supabase:seed`
 */
import { createServiceRoleClient } from "../src/lib/supabase/service";
import type { ProductInsert } from "../src/lib/supabase/types";

type Seed = ProductInsert & { id: string };

const products: Seed[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    name: "现代铬色面盆水龙头",
    brand: "Wiltek",
    category: "bathroom",
    subcategory: "faucet",
    style: "modern",
    primary_color: "chrome",
    material: "chrome_plated",
    installation: "countertop",
    applicable_space: ["master_bathroom", "guest_bathroom"],
    dimensions_mm: { length: 150, width: 50, height: 180 },
    weight_kg: 1.2,
    price_myr: 499,
    price_tier: "mid",
    color_variants: [
      { name: "Chrome", hex: "#C0C0C0", price_adjustment_myr: 0, purchase_url_override: null },
      { name: "Matte Black", hex: "#1C1C1C", price_adjustment_myr: 80, purchase_url_override: null },
      { name: "Brushed Gold", hex: "#B8860B", price_adjustment_myr: 150, purchase_url_override: null },
    ],
    description: "简约现代风格的铬色面盆水龙头，适合主卫与客卫。单把手控温，陶瓷阀芯，省水认证。",
    glb_url: "https://modelviewer.dev/shared-assets/models/Astronaut.glb",
    glb_size_kb: 280,
    thumbnail_url: null,
    purchase_url: "https://wiltek.com.my/products/faucet-chrome-modern",
    supplier: "Wiltek",
    status: "published",
    ai_filled_fields: ["style", "primary_color", "material"],
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    name: "北欧风实木餐椅",
    brand: "Wiltek",
    category: "furniture",
    subcategory: "dining_chair",
    style: "scandinavian",
    primary_color: "wood_light",
    material: "solid_wood",
    installation: "freestanding",
    applicable_space: ["dining_room", "study"],
    dimensions_mm: { length: 450, width: 500, height: 820 },
    weight_kg: 4.5,
    price_myr: 1280,
    price_tier: "mid",
    color_variants: [],
    description: "实木框架 + 软垫坐面，北欧风格百搭餐椅。可搭餐桌或书桌使用。",
    glb_url: "https://modelviewer.dev/shared-assets/models/RobotExpressive.glb",
    glb_size_kb: 2600,
    thumbnail_url: null,
    purchase_url: "https://wiltek.com.my/products/chair-oak-scandi",
    supplier: "Wiltek",
    status: "published",
    ai_filled_fields: ["style", "primary_color"],
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    name: "极简黄铜吊灯",
    brand: "Wiltek",
    category: "lighting",
    subcategory: "pendant_light",
    style: "minimalist",
    primary_color: "brass",
    material: "brass",
    installation: "pendant",
    applicable_space: ["living_room", "dining_room"],
    dimensions_mm: { length: 300, width: 300, height: 400 },
    weight_kg: 2.1,
    price_myr: 890,
    price_tier: "mid",
    color_variants: [],
    description: "极简几何造型黄铜吊灯，适合餐厅与客厅。E27 灯头，可搭配 LED 球泡。",
    glb_url: "https://modelviewer.dev/shared-assets/models/Horse.glb",
    glb_size_kb: 620,
    thumbnail_url: null,
    purchase_url: "https://wiltek.com.my/products/pendant-brass-minimal",
    supplier: "Wiltek",
    status: "published",
    ai_filled_fields: ["style", "material"],
  },
];

async function main() {
  const supabase = createServiceRoleClient();

  for (const p of products) {
    const { error } = await supabase
      .from("products")
      .upsert(p, { onConflict: "id" });
    if (error) {
      console.error(`❌ ${p.name}:`, error);
      process.exit(1);
    }
    console.log(`✓ upserted ${p.id}  ${p.name}`);
  }

  console.log(`\n✅ Seeded ${products.length} products`);
  console.log("   IDs:");
  for (const p of products) console.log(`   - ${p.id}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
