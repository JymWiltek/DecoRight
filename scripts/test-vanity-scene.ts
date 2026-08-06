/**
 * vanity/basin scene-rule + structural-constraint dry-run (PB). Exercises the
 * REAL pure buildScenePromptForProduct + pickSceneProps — NO OpenAI, NO DB,
 * net-zero.
 *
 * Run:
 *   NODE_OPTIONS='--conditions=react-server' \
 *     npx tsx --env-file=.env.local scripts/test-vanity-scene.ts
 */
import { buildScenePromptForProduct } from "../src/lib/scene-cover";
import { resolveScenePropSpecs, pickSceneProps } from "../config/scene-style-rules";

let failures = 0;
function assert(cond: boolean, label: string) {
  console.log(`   ${cond ? "✓" : "✗ FAIL"} ${label}`);
  if (!cond) failures++;
}

type P = Parameters<typeof buildScenePromptForProduct>[0];
function mk(over: Partial<P>): P {
  return {
    item_type: "bathroom_vanity",
    name: "Black Wall Hung Vanity",
    colors: ["black"],
    attributes: { mounting: "wall_mounted" },
    subtype_slug: null,
    dimensions_mm: { length: 800, width: 460, height: 500 },
    ...over,
  } as P;
}
function prompt(over: Partial<P>): string {
  const r = buildScenePromptForProduct(mk(over), "seed-1", { props: [] });
  if (!r.ok) throw new Error(`unexpectedly blocked: ${r.reason}`);
  return r.prompt;
}

(async () => {
  console.log("\n── ① vanity(挂墙)→ 龙头 + 镜子 + FORBIDDEN + 结构「无腿悬空」──\n");
  {
    const p = prompt({ item_type: "bathroom_vanity", attributes: { mounting: "wall_mounted" } });
    assert(/FAUCET \(mandatory/.test(p), "龙头必配");
    assert(/MIRROR \(mandatory/.test(p), "镜子必配");
    assert(/do NOT render a bare basin with NO faucet/.test(p), "FORBIDDEN 无龙头裸盆");
    assert(/EMPTY with no mirror/.test(p), "FORBIDDEN 盆上方空墙无镜");
    assert(/STRUCTURAL INTEGRITY/.test(p), "结构约束注入");
    assert(/WALL-MOUNTED/.test(p) && /NO legs/.test(p), "挂墙:无腿、下方悬空");
    assert(!/FLOOR-STANDING/.test(p), "挂墙不含落地句");
  }

  console.log("\n── ② basin(落地)→ 结构「触地」──\n");
  {
    const p = prompt({ item_type: "basin", name: "Free Standing Basin", attributes: { mounting: "floor_standing" } });
    assert(/FAUCET \(mandatory/.test(p) && /MIRROR \(mandatory/.test(p), "basin 也龙头+镜子必配");
    assert(/FLOOR-STANDING/.test(p) && /rests firmly ON the floor/.test(p), "落地:触地");
    assert(!/NO legs/.test(p), "落地不含无腿句");
  }

  console.log("\n── ③ vanity(item_type=vanity)共享同规则 ──\n");
  {
    const p = prompt({ item_type: "vanity", name: "Rose Gold Vanity" });
    assert(/FAUCET \(mandatory/.test(p) && /MIRROR \(mandatory/.test(p), "vanity 键同规则");
  }

  console.log("\n── ④ 可选道具:多种子有出有不出;无参照不画 ──\n");
  {
    const specs = resolveScenePropSpecs("bathroom_vanity");
    assert(specs.length === 3, `3 个可选道具(towel_ring/glass_shelf/rack)(实测 ${specs.length})`);
    assert(specs.every((s) => s.probability === 0.3), "各 30% 概率");
    assert(!specs.some((s) => s.key === "mirror"), "mirror 已移出道具池(改必配)");
    // With a catalog reference, some seeds draw props, some draw none.
    const withRef = { bathroom_equipments: ["ref-1"] };
    const counts = Array.from({ length: 12 }, (_, i) => pickSceneProps(specs, `s${i}`, withRef).length);
    assert(counts.some((c) => c > 0), "有参照 → 部分种子出道具");
    assert(counts.some((c) => c === 0), "有参照 → 部分种子零道具(概率)");
    // Iron law: no catalog reference ⇒ never drawn.
    const noRef = Array.from({ length: 12 }, (_, i) => pickSceneProps(specs, `s${i}`, {}).length);
    assert(noRef.every((c) => c === 0), "无白底参照 → 一律不画(铁律)");
  }

  console.log("\n── ⑤ 非 vanity 回归:toilet 无龙头/镜子必配(仍得结构)──\n");
  {
    const p = prompt({ item_type: "toilet", name: "White Toilet", attributes: { mounting: "floor_standing" } });
    assert(/FLUSH AGAINST A WALL/.test(p), "toilet 原规则不变");
    assert(!/FAUCET \(mandatory/.test(p) && !/MIRROR \(mandatory/.test(p), "toilet 不含 vanity 龙头/镜子");
    assert(/STRUCTURAL INTEGRITY/.test(p), "toilet 也得无条件结构约束(全类别)");
  }

  console.log("\n── ⑥ 结构约束无条件:faucet(mounting 未知)仍得基线,无挂墙/落地细则 ──\n");
  {
    const p = prompt({ item_type: "faucet", name: "Basin Mixer", attributes: {} });
    assert(/STRUCTURAL INTEGRITY/.test(p), "未知 mounting 也注入结构基线");
    assert(!/WALL-MOUNTED/.test(p) && !/FLOOR-STANDING/.test(p), "未知 mounting → 无挂墙/落地细则");
  }

  console.log(`\n${failures === 0 ? "✓ ALL PASS" : `✗ ${failures} FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
