/**
 * Scene-prompt assembly smoke test — PROMPT LAYER ONLY, zero OpenAI calls.
 *
 * Proves buildScenePromptForProduct (the single assembly + interception entry)
 * against three real products:
 *   • a toilet   → mounting + toilet placement rule + real size, in that order
 *   • a basin    → mounting + real size, NO item_type rule (layer doesn't leak)
 *   • no-dims    → BLOCKED, never reaches generation
 *
 * Run (server-only module needs the react-server condition):
 *   NODE_OPTIONS='--conditions=react-server' \
 *     npx tsx --env-file=.env.local scripts/smoke-scene-prompt.ts
 */
import { createServiceRoleClient } from "../src/lib/supabase/service";
import { buildScenePromptForProduct } from "../src/lib/scene-cover";

type Row = {
  id: string;
  name: string;
  item_type: string | null;
  colors: string[] | null;
  attributes: Record<string, unknown> | null;
  subtype_slug: string | null;
  dimensions_mm: { length?: number; width?: number; height?: number } | null;
};

const COLS =
  "id,name,item_type,colors,attributes,subtype_slug,dimensions_mm";
const mounting = (r: Row) =>
  r.attributes && typeof r.attributes === "object"
    ? (r.attributes as Record<string, unknown>).mounting
    : null;
const hasAllDims = (d: Row["dimensions_mm"]) =>
  !!d && [d.length, d.width, d.height].every((v) => typeof v === "number" && v > 0);

let failures = 0;
const check = (label: string, cond: boolean) => {
  console.log(`   ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures++;
};

async function main() {
  const sb = createServiceRoleClient();
  const { data } = await sb.from("products").select(COLS);
  const rows = (data ?? []) as unknown as Row[];

  const toilet = rows.find(
    (r) => r.item_type === "toilet" && mounting(r) && hasAllDims(r.dimensions_mm),
  );
  const basin = rows.find(
    (r) => r.item_type === "basin" && mounting(r) && hasAllDims(r.dimensions_mm),
  );
  const noDims = rows.find(
    (r) => mounting(r) && !hasAllDims(r.dimensions_mm),
  );
  if (!toilet || !basin || !noDims) {
    throw new Error(
      `missing test fixtures: toilet=${!!toilet} basin=${!!basin} noDims=${!!noDims}`,
    );
  }

  // ── 1. TOILET — three segments, correct order ──
  console.log(`\n=== 1. TOILET · ${toilet.name} (mounting=${mounting(toilet)}) ===`);
  const t = buildScenePromptForProduct(toilet, toilet.id);
  if (!t.ok) throw new Error(`toilet unexpectedly blocked: ${t.reason}`);
  console.log("\n--- assembled prompt ---\n" + t.prompt + "\n------------------------");
  const iMount = t.prompt.indexOf("INSTALLATION (mandatory)");
  const iPlace = t.prompt.indexOf("PLACEMENT (mandatory)");
  const iSize = t.prompt.indexOf("REAL SIZE (mandatory)");
  check("① mounting (INSTALLATION) present", iMount >= 0);
  check("② toilet placement (PLACEMENT … BACK … FLUSH AGAINST A WALL) present",
    iPlace >= 0 && /toilet's BACK/.test(t.prompt) && /FLUSH AGAINST A WALL/.test(t.prompt));
  check("③ real size (REAL SIZE … mm) present", iSize >= 0 && /mm wide × \d+ mm deep × \d+ mm tall/.test(t.prompt));
  check("order is mounting → placement → size", iMount < iPlace && iPlace < iSize);

  // ── 2. BASIN — mounting + size, NO item_type rule ──
  console.log(`\n=== 2. BASIN · ${basin.name} (mounting=${mounting(basin)}) ===`);
  const b = buildScenePromptForProduct(basin, basin.id);
  if (!b.ok) throw new Error(`basin unexpectedly blocked: ${b.reason}`);
  console.log("\n--- assembled prompt ---\n" + b.prompt + "\n------------------------");
  check("mounting present", b.prompt.includes("INSTALLATION (mandatory)"));
  check("real size present", /REAL SIZE \(mandatory\)/.test(b.prompt));
  check("NO item_type rule leaked (no PLACEMENT, no toilet wording)",
    !b.prompt.includes("PLACEMENT (mandatory)") && !/toilet's BACK/.test(b.prompt));

  // ── 3. NO-DIMS — intercepted before generation ──
  console.log(`\n=== 3. NO-DIMENSIONS · ${noDims.name} (dims=${JSON.stringify(noDims.dimensions_mm)}) ===`);
  const n = buildScenePromptForProduct(noDims, noDims.id);
  check("blocked (ok:false) — never enters the generation queue", n.ok === false);
  check("reason names the missing dimensions", !n.ok && /dimensions/i.test(n.reason));
  console.log(`   reason: ${n.ok ? "(generated!)" : n.reason}`);

  console.log(`\n${failures === 0 ? "✓ ALL PASS" : `✗ ${failures} FAILED`}`);
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
