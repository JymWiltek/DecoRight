/**
 * Scene-gate widening test (PB). Exercises the REAL exported
 * hasQualifiedSceneAmongImages (with an INJECTED white-bg judge — no network)
 * and the REAL checkPublishGates. Net-zero, 0 OpenAI.
 *
 * Run:
 *   NODE_OPTIONS='--conditions=react-server' \
 *     npx tsx --env-file=.env.local scripts/test-scene-gate.ts
 */
import { hasQualifiedSceneAmongImages } from "../src/lib/scene-cover";
import {
  checkPublishGates,
  type PublishGateInput,
} from "../src/lib/publish-gates";

let failures = 0;
function assert(cond: boolean, label: string) {
  console.log(`   ${cond ? "✓" : "✗ FAIL"} ${label}`);
  if (!cond) failures++;
}

const WHITE = new Set([
  "https://x/cover-white.jpg",
  "https://x/w1.jpg",
  "https://x/w2.jpg",
]);
/** Deterministic mock of isWhiteBackgroundImage — no fetch. Counts calls so we
 *  can prove the short-circuit. */
let whiteCalls = 0;
const mockIsWhite = async (url: string) => {
  whiteCalls++;
  return WHITE.has(url);
};

/** Gate input with every OTHER gate satisfied, so only `scene` can fail. */
function facts(hasScene: boolean): PublishGateInput {
  return {
    rooms: ["bathroom"],
    cutoutApprovedCount: 1,
    glbUrl: "x",
    fbxUrl: "x",
    supplierCount: 1,
    hasScene,
    defect: false,
  };
}

(async () => {
  console.log("\n── A. hasQualifiedSceneAmongImages (non-cover images) ──\n");

  // ① a real scene photo among white images → qualifies.
  whiteCalls = 0;
  assert(
    (await hasQualifiedSceneAmongImages(
      ["https://x/w1.jpg", "https://x/real-scene.jpg"],
      mockIsWhite,
    )) === true,
    "白图 + 一张实拍非白底 → 合格(过闸)",
  );
  assert(whiteCalls === 2, `短路:实拍在第2张,判了 2 次(实测 ${whiteCalls})`);

  // ② short-circuit stops at the FIRST non-white.
  whiteCalls = 0;
  await hasQualifiedSceneAmongImages(
    ["https://x/real-scene.jpg", "https://x/w1.jpg", "https://x/w2.jpg"],
    mockIsWhite,
  );
  assert(whiteCalls === 1, `第1张即非白 → 只判 1 次就短路(实测 ${whiteCalls})`);

  // ③ an AI /scene- URL qualifies with NO fetch.
  whiteCalls = 0;
  assert(
    (await hasQualifiedSceneAmongImages(["https://x/scene-abc123.png"], mockIsWhite)) === true,
    "/scene- AI 图 → 合格,零像素判定",
  );
  assert(whiteCalls === 0, `/scene- 走廉价通道,不 fetch(实测 ${whiteCalls} 次判定)`);

  // ④ all white → NOT qualified (hard-gate side).
  assert(
    (await hasQualifiedSceneAmongImages(
      ["https://x/w1.jpg", "https://x/w2.jpg"],
      mockIsWhite,
    )) === false,
    "全白底 → 不合格(照拦)",
  );

  // ⑤ empty / null-only → not qualified, no judging.
  whiteCalls = 0;
  assert(
    (await hasQualifiedSceneAmongImages([null, undefined], mockIsWhite)) === false,
    "无图 → 不合格",
  );
  assert(whiteCalls === 0, "无候选 → 不判定");

  console.log("\n── B. publish gate reacts to the widened hasScene ──\n");

  // Compose hasScene exactly as loadPublishGateFacts does: cover path OR any
  // non-cover image qualifies. (coverPublishable is the #32+#33 cover result.)
  const compose = async (coverPublishable: boolean, nonCover: string[]) =>
    coverPublishable || (await hasQualifiedSceneAmongImages(nonCover, mockIsWhite));

  // 封面白底 + 第二张实拍场景照 → 过闸(scene 不在缺失)
  {
    const hasScene = await compose(false, ["https://x/cover-white.jpg", "https://x/real-scene.jpg"]);
    const r = checkPublishGates(facts(hasScene));
    assert(r.ok === true, "封面白底 + 实拍第二张 → 过闸(scene 不拦)");
  }
  // 全部白底 → 被拦,scene 在缺失
  {
    const hasScene = await compose(false, ["https://x/w1.jpg", "https://x/w2.jpg"]);
    const r = checkPublishGates(facts(hasScene));
    assert(r.ok === false && r.reasons.includes("scene"), "全白底 → 拦,理由含 scene");
  }
  // 封面本身就是场景图(coverPublishable=true)→ 回归:仍过闸
  {
    const hasScene = await compose(true, ["https://x/w1.jpg"]);
    const r = checkPublishGates(facts(hasScene));
    assert(r.ok === true, "封面即场景图 → 回归不受影响,过闸");
  }

  console.log(`\n${failures === 0 ? "✓ ALL PASS" : `✗ ${failures} FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
