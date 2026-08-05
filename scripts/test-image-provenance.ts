/**
 * Three-layer image-provenance test (PB). Exercises the REAL layer-1 rule
 * classifier (injected white-bg judge — no fetch), the REAL layer-2 AI
 * classifier under AI_SUGGEST_MOCK (0 real OpenAI), and the anti-overwrite
 * guard. Net-zero.
 *
 * Run:
 *   NODE_OPTIONS='--conditions=react-server' npx tsx scripts/test-image-provenance.ts
 */
process.env.AI_SUGGEST_MOCK = "1"; // force the mock seam BEFORE any AI call

import {
  classifyProvenanceRule,
  canAutoWriteProvenance,
  PROVENANCE_UNIT_USD_EST,
} from "../src/lib/admin/image-provenance";
import { classifyPhotoProvenance } from "../src/lib/ai/classify-photo";

let failures = 0;
function assert(cond: boolean, label: string) {
  console.log(`   ${cond ? "✓" : "✗ FAIL"} ${label}`);
  if (!cond) failures++;
}

(async () => {
  console.log("\n── 层1:确定性规则(零 AI,注入白底判定)──\n");
  {
    let whiteCalls = 0;
    const isWhite = async (u: string) => {
      whiteCalls++;
      return u.includes("white");
    };
    // AI /scene- URL → ai_scene, WITHOUT touching the white-bg judge.
    assert(
      (await classifyProvenanceRule("https://x/abc/scene-123.png", isWhite)) === "ai_scene",
      "/scene- 图 → ai_scene",
    );
    assert(whiteCalls === 0, "/scene- 命中前不做白底判定(廉价)");
    // white background → product_shot.
    assert(
      (await classifyProvenanceRule("https://x/white-basin.jpg", isWhite)) === "product_shot",
      "白底图 → product_shot",
    );
    // neither → null (a layer-2 candidate).
    assert(
      (await classifyProvenanceRule("https://x/room-photo.jpg", isWhite)) === null,
      "非场景非白底 → null(层2候选)",
    );
    assert((await classifyProvenanceRule(null, isWhite)) === null, "无 URL → null");
  }

  console.log("\n── 层2:AI 判定(mock,0 真实调用)──\n");
  {
    assert(
      (await classifyPhotoProvenance({ imageUrl: "https://x/p.jpg", name: "REALPHOTO bathroom shot" })) === "real_photo",
      "候选实拍 → real_photo",
    );
    assert(
      (await classifyPhotoProvenance({ imageUrl: "https://x/p.jpg", name: "generic render" })) === "product_shot",
      "候选渲染图 → 回落 product_shot",
    );
  }

  console.log("\n── 层3:人工标注最高权威,自动层不得覆盖 ──\n");
  {
    assert(canAutoWriteProvenance("manual") === false, "manual → 自动层不可写(守护)");
    assert(canAutoWriteProvenance("auto_rule") === true, "auto_rule → 可被自动层更新");
    assert(canAutoWriteProvenance("auto_ai") === true, "auto_ai → 可被自动层更新");
    assert(canAutoWriteProvenance(null) === true, "未决 → 可写");
  }

  console.log("\n── 费用预估常量 ──\n");
  assert(PROVENANCE_UNIT_USD_EST === 0.01, "每张 AI 候选预估 ~$0.01");

  console.log(`\n${failures === 0 ? "✓ ALL PASS" : `✗ ${failures} FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
