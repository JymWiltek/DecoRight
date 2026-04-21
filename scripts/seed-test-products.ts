/**
 * Seed 3 permanent test products for Phase 2.5 dev/demo.
 * Idempotent: re-run to refresh. Keyed by fixed UUIDs.
 *
 * Run AFTER applying `supabase/migrations/0002_taxonomy_and_multiselect.sql`,
 * since this seeds against the new schema (item_type + rooms[] + styles[] +
 * colors[] + materials[]).
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
    item_type: "faucet",
    rooms: ["bathroom", "kitchen"],
    styles: ["modern", "minimalist"],
    colors: ["chrome", "black", "gold"],
    materials: ["chrome_plated", "stainless_steel"],
    dimensions_mm: { length: 150, width: 50, height: 180 },
    weight_kg: 1.2,
    price_myr: 499,
    price_tier: "mid",
    description:
      "简约现代风格的铬色面盆水龙头，适合主卫与客卫。单把手控温，陶瓷阀芯，省水认证。",
    glb_url: "https://modelviewer.dev/shared-assets/models/Astronaut.glb",
    glb_size_kb: 280,
    thumbnail_url: null,
    purchase_url: "https://wiltek.com.my/products/faucet-chrome-modern",
    supplier: "Wiltek",
    status: "published",
    ai_filled_fields: ["styles", "colors", "materials"],
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    name: "北欧风实木餐椅",
    brand: "Wiltek",
    item_type: "dining_chair",
    rooms: ["dining_room", "living_room"],
    styles: ["scandinavian", "minimalist"],
    colors: ["wood_light", "beige"],
    materials: ["solid_wood", "fabric"],
    dimensions_mm: { length: 450, width: 500, height: 820 },
    weight_kg: 4.5,
    price_myr: 1280,
    price_tier: "mid",
    description: "实木框架 + 软垫坐面，北欧风格百搭餐椅。可搭餐桌或书桌使用。",
    glb_url: "https://modelviewer.dev/shared-assets/models/RobotExpressive.glb",
    glb_size_kb: 2600,
    thumbnail_url: null,
    purchase_url: "https://wiltek.com.my/products/chair-oak-scandi",
    supplier: "Wiltek",
    status: "published",
    ai_filled_fields: ["styles", "colors"],
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    name: "极简黄铜吊灯",
    brand: "Wiltek",
    item_type: "pendant_light",
    rooms: ["dining_room", "living_room"],
    styles: ["minimalist", "modern", "luxury"],
    colors: ["brass", "gold"],
    materials: ["brass"],
    dimensions_mm: { length: 300, width: 300, height: 400 },
    weight_kg: 2.1,
    price_myr: 890,
    price_tier: "mid",
    description: "极简几何造型黄铜吊灯，适合餐厅与客厅。E27 灯头，可搭配 LED 球泡。",
    glb_url: "https://modelviewer.dev/shared-assets/models/Horse.glb",
    glb_size_kb: 620,
    thumbnail_url: null,
    purchase_url: "https://wiltek.com.my/products/pendant-brass-minimal",
    supplier: "Wiltek",
    status: "published",
    ai_filled_fields: ["styles", "materials"],
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
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
