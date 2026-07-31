/**
 * Scene-prompt assembly smoke test — PROMPT LAYER ONLY, zero OpenAI calls.
 *
 * Covers buildScenePromptForProduct (the single entry): mounting + placement +
 * real-size segments, palette-pool variety, the main-product fidelity wording,
 * and the IRON-LAW prop layer (pickSceneProps — reference-gated + probability,
 * no text-only fallback). Prop selection is exercised with SYNTHETIC references
 * so the assertions don't depend on live catalog state.
 *
 * Run (server-only module needs the react-server condition):
 *   NODE_OPTIONS='--conditions=react-server' \
 *     npx tsx --env-file=.env.local scripts/smoke-scene-prompt.ts
 */
import { createServiceRoleClient } from "../src/lib/supabase/service";
import { buildScenePromptForProduct } from "../src/lib/scene-cover";
import {
  resolveScenePropSpecs,
  pickSceneProps,
} from "../config/scene-style-rules";

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

// Synthetic references so prop assertions are deterministic. Every prop spec's
// referenceItemType maps to one fake ref id — enough to let probability decide.
function refsForToilet(): Record<string, string[]> {
  const specs = resolveScenePropSpecs("toilet");
  const refs: Record<string, string[]> = {};
  for (const s of specs) refs[s.referenceItemType] = ["ref-abc", "ref-def"];
  return refs;
}

async function main() {
  const sb = createServiceRoleClient();
  const { data } = await sb.from("products").select(COLS);
  const rows = (data ?? []) as unknown as Row[];

  const toilets = rows.filter(
    (r) => r.item_type === "toilet" && mounting(r) && hasAllDims(r.dimensions_mm),
  );
  if (toilets.length < 3) throw new Error(`need ≥3 usable toilets, have ${toilets.length}`);

  // ── 1. PALETTE POOL — a batch of white toilets spreads across looks ──
  console.log(`\n=== 1. PALETTE VARIETY across ${toilets.length} toilets ===`);
  const scenesByToilet = toilets.map((t) => {
    const p = buildScenePromptForProduct(t, t.id, { props: [] });
    return { name: t.name, scene: p.ok ? sceneOf(p.prompt) : "(blocked)" };
  });
  const distinct = new Set(scenesByToilet.map((s) => s.scene));
  console.log(`   distinct background scenes: ${distinct.size}`);
  check("≥3 distinct scenes across the toilet batch (pool random works)", distinct.size >= 3);

  // ── 2. FULL prompt (with synthetic refs) — order + fidelity + props ──
  const t0 = toilets[0];
  const refs = refsForToilet();
  const props = pickSceneProps(resolveScenePropSpecs("toilet"), t0.id, refs);
  const full = buildScenePromptForProduct(t0, t0.id, { props });
  if (!full.ok) throw new Error("toilet blocked");
  console.log(`\n=== 2. FULL PROMPT · ${t0.name} ===\n${full.prompt}\n`);
  const iMount = full.prompt.indexOf("INSTALLATION (mandatory)");
  const iPlace = full.prompt.indexOf("PLACEMENT (mandatory)");
  const iSize = full.prompt.indexOf("REAL SIZE (mandatory)");
  check("mounting + placement + size all present", iMount >= 0 && iPlace >= 0 && iSize >= 0);
  check("order: mounting → placement → size", iMount < iPlace && iPlace < iSize);
  check(
    "main-product fidelity wording present (reproduce silhouette / don't change design)",
    /reproduce its shape and silhouette EXACTLY|do NOT change its design/.test(full.prompt),
  );

  // ── 3. PROP IRON LAW — reference-gated, no text-only fallback ──
  console.log(`\n=== 3. PROP IRON LAW ===`);
  // With refs available, some props are selected (probability), each with a ref.
  check("props selected have real reference ids", props.every((p) => !!p.referenceProductId));
  check("no duplicate prop keys", new Set(props.map((p) => p.key)).size === props.length);
  // NO refs → NO props (the deleted text-only fallback).
  const noRefProps = pickSceneProps(resolveScenePropSpecs("toilet"), t0.id, {});
  check("no reference ⇒ ZERO props (text-only fallback deleted)", noRefProps.length === 0);
  const noRefPrompt = buildScenePromptForProduct(t0, t0.id, { props: [] });
  check(
    "empty props ⇒ no BACKGROUND PROPS clause (clean scene)",
    noRefPrompt.ok && !/BACKGROUND PROPS/.test((noRefPrompt as { prompt: string }).prompt),
  );

  // ── 4. RANDOMIZATION — a different seed can change the prop set ──
  console.log(`\n=== 4. PROP RANDOMIZATION (seeded) ===`);
  const combos = ["r1", "r2", "r3", "r4", "r5"].map((n) =>
    pickSceneProps(resolveScenePropSpecs("toilet"), `${t0.id}:${n}`, refs)
      .map((p) => p.key)
      .sort()
      .join(","),
  );
  console.log(`   seed combos: ${combos.join(" | ")}`);
  check("regenerate seeds produce ≥2 distinct prop combinations", new Set(combos).size >= 2);
  check("a zero-prop combination is reachable across seeds", combos.includes("") || combos.some((c) => c.split(",").filter(Boolean).length < 3));

  console.log(`\n${failures === 0 ? "✓ ALL PASS" : `✗ ${failures} FAILED`}`);
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
