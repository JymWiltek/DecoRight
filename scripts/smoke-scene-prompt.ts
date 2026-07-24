/**
 * Scene-prompt assembly smoke test — PROMPT LAYER ONLY, zero OpenAI calls.
 *
 * Covers the whole assembly through buildScenePromptForProduct (the single
 * entry): #28's mounting + toilet placement + real-size segments, PLUS this
 * PR's palette pools (varied per product), the SEA prop段, and the in-catalog
 * reference lookup + id recording.
 *
 * Run (server-only module needs the react-server condition):
 *   NODE_OPTIONS='--conditions=react-server' \
 *     npx tsx --env-file=.env.local scripts/smoke-scene-prompt.ts
 */
import { createServiceRoleClient } from "../src/lib/supabase/service";
import {
  buildScenePromptForProduct,
  findSceneReferenceProducts,
} from "../src/lib/scene-cover";
import { resolveScenePropRule } from "../config/scene-style-rules";

type Row = {
  id: string;
  name: string;
  item_type: string | null;
  colors: string[] | null;
  attributes: Record<string, unknown> | null;
  subtype_slug: string | null;
  dimensions_mm: { length?: number; width?: number; height?: number } | null;
};

const COLS = "id,name,item_type,colors,attributes,subtype_slug,dimensions_mm";
const mounting = (r: Row) =>
  r.attributes && typeof r.attributes === "object"
    ? (r.attributes as Record<string, unknown>).mounting
    : null;
const hasAllDims = (d: Row["dimensions_mm"]) =>
  !!d && [d.length, d.width, d.height].every((v) => typeof v === "number" && v > 0);
const sceneOf = (prompt: string) =>
  prompt.match(/into (.+?)\. (?:INSTALLATION|PLACEMENT|REAL SIZE|BACKGROUND|The product)/)?.[1] ??
  "(?)";

let failures = 0;
const check = (label: string, cond: boolean) => {
  console.log(`   ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures++;
};

async function main() {
  const sb = createServiceRoleClient();
  const { data } = await sb.from("products").select(COLS);
  const rows = (data ?? []) as unknown as Row[];

  const toiletProps = async (r: Row) => {
    const rule = resolveScenePropRule(r.item_type);
    if (!rule) return null;
    const refs = await findSceneReferenceProducts(sb, rule.referenceItemTypes);
    return { guidance: rule.guidance, referenceProductIds: refs.map((x) => x.id) };
  };

  const toilets = rows.filter(
    (r) => r.item_type === "toilet" && mounting(r) && hasAllDims(r.dimensions_mm),
  );
  if (toilets.length < 3) throw new Error(`need ≥3 usable toilets, have ${toilets.length}`);

  // ── 1. PALETTE POOL — a batch of white toilets spreads across looks ──
  console.log(`\n=== 1. PALETTE VARIETY across ${toilets.length} toilets ===`);
  const scenesByToilet = await Promise.all(
    toilets.map(async (t) => {
      const p = buildScenePromptForProduct(t, t.id, await toiletProps(t));
      return { name: t.name, scene: p.ok ? sceneOf(p.prompt) : "(blocked)" };
    }),
  );
  const distinct = new Set(scenesByToilet.map((s) => s.scene));
  console.log(`   distinct background scenes: ${distinct.size}`);
  for (const s of [...distinct].slice(0, 5)) console.log(`     · ${s}`);
  check("≥3 distinct scenes across the toilet batch (pool random works)", distinct.size >= 3);

  // Pick 3 toilets with pairwise-different scenes to print in full.
  const picked: typeof scenesByToilet = [];
  const seen = new Set<string>();
  for (const s of scenesByToilet) {
    if (!seen.has(s.scene)) { picked.push(s); seen.add(s.scene); }
    if (picked.length === 3) break;
  }
  check("3 sample toilets have pairwise-different scenes", new Set(picked.map((p) => p.scene)).size === 3);
  for (const p of picked) console.log(`   • ${p.name} → ${p.scene}`);

  // ── 2. FULL toilet prompt — all segments in order, props段 present ──
  const t0 = toilets[0];
  const t0props = await toiletProps(t0);
  const full = buildScenePromptForProduct(t0, t0.id, t0props);
  if (!full.ok) throw new Error("toilet blocked");
  console.log(`\n=== 2. FULL PROMPT · ${t0.name} ===\n${full.prompt}\n`);
  const iMount = full.prompt.indexOf("INSTALLATION (mandatory)");
  const iPlace = full.prompt.indexOf("PLACEMENT (mandatory)");
  const iSize = full.prompt.indexOf("REAL SIZE (mandatory)");
  const iProps = full.prompt.indexOf("BACKGROUND PROPS");
  check("#28 mounting + placement + size all present", iMount >= 0 && iPlace >= 0 && iSize >= 0);
  check("props段 present (BACKGROUND PROPS)", iProps >= 0);
  check("order: mounting → placement → size → props", iMount < iPlace && iPlace < iSize && iSize < iProps);
  check("props段 keeps product the hero / props secondary", /SECONDARY and SMALL|the hero|must not overlap/.test(full.prompt));

  // ── 3. REFERENCE mechanism — attached + recorded when catalog has them ──
  console.log(`\n=== 3. IN-CATALOG REFERENCES (toilet → bathroom_equipments) ===`);
  check("reference products found in catalog", (t0props?.referenceProductIds.length ?? 0) > 0);
  check("props段 tells model to use the ATTACHED reference photos", /ATTACHED reference product photos/.test(full.prompt));
  check("reference ids recorded on the result (future-link data)", full.referenceProductIds.length > 0 && full.referenceProductIds.every((id) => typeof id === "string"));
  console.log(`   referenceProductIds: ${full.referenceProductIds.join(", ")}`);

  // ── 4. DEGRADE — no matching accessories → text-only, no error ──
  console.log(`\n=== 4. DEGRADE (no catalog accessories) ===`);
  const emptyRefs = await findSceneReferenceProducts(sb, ["__nonexistent_type__"]);
  check("reference lookup returns [] for an empty type (no throw)", emptyRefs.length === 0);
  const degraded = buildScenePromptForProduct(t0, t0.id, {
    guidance: resolveScenePropRule("toilet")!.guidance,
    referenceProductIds: [],
  });
  check("degraded prompt still ok, props段 present", degraded.ok && /BACKGROUND PROPS/.test((degraded as { prompt: string }).prompt));
  check("degraded prompt has NO 'ATTACHED reference' wording", degraded.ok && !/ATTACHED reference/.test((degraded as { prompt: string }).prompt));

  // ── 5. STABLE per product; Regenerate changes it ──
  console.log(`\n=== 5. STABLE vs REGENERATE ===`);
  const a = buildScenePromptForProduct(t0, t0.id, t0props);
  const b = buildScenePromptForProduct(t0, t0.id, t0props);
  check("same seed → identical scene (stable, no churn on refresh)", a.ok && b.ok && sceneOf(a.prompt) === sceneOf(b.prompt));
  const regenScenes = ["r1", "r2", "r3", "r4"].map((n) => {
    const r = buildScenePromptForProduct(t0, `${t0.id}:${n}`, t0props);
    return r.ok ? sceneOf(r.prompt) : "(?)";
  });
  const baseScene = a.ok ? sceneOf(a.prompt) : "(?)";
  check("a Regenerate seed can land a DIFFERENT scene", regenScenes.some((s) => s !== baseScene));
  console.log(`   base: ${baseScene}`);
  regenScenes.forEach((s, i) => console.log(`   regen r${i + 1}: ${s}${s !== baseScene ? "  ← changed" : ""}`));

  console.log(`\n${failures === 0 ? "✓ ALL PASS" : `✗ ${failures} FAILED`}`);
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
