/**
 * Storage-connectivity + retry-wait test (PB). Exercises the REAL exported
 * waitForConnectivity / putWithNetworkRetry / probeStorageReachable with
 * injected probe + sleep and a mocked fetch — NO network, net-zero, 0 OpenAI.
 *
 * Run:  npx tsx scripts/test-storage-connectivity.ts
 */
import {
  waitForConnectivity,
  putWithNetworkRetry,
  PUT_RETRY_DELAYS_MS,
  PUT_CONNECTIVITY_WAIT_CAP_MS,
  type PutAttemptResult,
} from "../src/lib/upload-trace";
import { probeStorageReachable } from "../src/lib/admin/storage-probe";
import {
  initCardUpload,
  countPendingFiles,
  buildCardFd,
} from "../src/lib/admin/bulk-upload-state";
import type { DraftCardState } from "../src/components/admin/ProductDraftCard";

let failures = 0;
function assert(cond: boolean, label: string) {
  console.log(`   ${cond ? "✓" : "✗ FAIL"} ${label}`);
  if (!cond) failures++;
}
const noopSleep = async () => {};

(async () => {
  console.log(`\n── 重试间隔拉长 ──\n`);
  assert(
    PUT_RETRY_DELAYS_MS[0] === 2000 && PUT_RETRY_DELAYS_MS[1] === 15000,
    `间隔 2s / 15s(实测 ${PUT_RETRY_DELAYS_MS.join("/")}ms)`,
  );
  assert(PUT_CONNECTIVITY_WAIT_CAP_MS === 60000, "连通性等待上限 60s");

  console.log(`\n── waitForConnectivity ──\n`);
  {
    // recovers on the 3rd probe → true.
    let calls = 0;
    const ok = await waitForConnectivity(async () => ++calls >= 3, {
      capMs: 10000,
      pollMs: 1000,
      sleep: noopSleep,
    });
    assert(ok === true && calls === 3, `断路中轮询到恢复 → true(探测 ${calls} 次)`);
  }
  {
    // never recovers → false at the cap.
    let calls = 0;
    const ok = await waitForConnectivity(async () => (calls++, false), {
      capMs: 5000,
      pollMs: 1000,
      sleep: noopSleep,
    });
    assert(ok === false, "一直断路 → 到上限返回 false(进重传路径)");
  }

  console.log(`\n── putWithNetworkRetry + 连通性门 ──\n`);
  {
    // network-error twice, then connectivity returns → the 2nd retry succeeds.
    const seq: PutAttemptResult[] = [
      { kind: "network-error", error: new TypeError("Failed to fetch") },
      { kind: "network-error", error: new TypeError("Failed to fetch") },
      { kind: "ok", status: 200 },
    ];
    let i = 0;
    const { result, retries, gaveUpWaiting } = await putWithNetworkRetry(
      async () => seq[Math.min(i++, seq.length - 1)],
      { sleep: noopSleep, probe: async () => true },
    );
    assert(result.kind === "ok", "断路后恢复 → 最终成功");
    assert(retries === 2 && !gaveUpWaiting, `用满 2 次重试、未放弃(retry=${retries})`);
  }
  {
    // stays down: the connectivity gate before the 2nd retry never goes green →
    // give up to the refill path.
    let probeCalls = 0;
    const { result, retries, gaveUpWaiting } = await putWithNetworkRetry(
      async () => ({ kind: "network-error", error: new TypeError("Failed to fetch") }),
      {
        sleep: noopSleep,
        probe: async () => (probeCalls++, false),
        connectivityCapMs: 6000,
        connectivityPollMs: 2000,
      },
    );
    assert(
      result.kind === "network-error" && gaveUpWaiting === true,
      "第二次重试前探测持续不通 → 挂起等待后放弃(gaveUpWaiting)",
    );
    assert(retries === 1, `第二次重试未发起(retry=${retries})`);
    assert(probeCalls > 0, `确有探测(${probeCalls} 次)`);
  }
  {
    // HTTP 413 → no retry, no probe.
    let probeCalls = 0;
    const { result, retries } = await putWithNetworkRetry(
      async () => ({ kind: "http-error", status: 413, body: "too large" }),
      { sleep: noopSleep, probe: async () => (probeCalls++, true) },
    );
    assert(
      result.kind === "http-error" && retries === 0 && probeCalls === 0,
      "HTTP 413 → 0 重试、不探测、立即报错",
    );
  }

  console.log(`\n── probeStorageReachable(mock fetch)──\n`);
  {
    const origFetch = globalThis.fetch;
    const origUrl = process.env.NEXT_PUBLIC_APP_SUPABASE_URL;
    process.env.NEXT_PUBLIC_APP_SUPABASE_URL = "https://proj.supabase.co";
    try {
      // any HTTP response (even opaque/404) → reachable.
      globalThis.fetch = (async () => ({}) as Response) as typeof fetch;
      assert((await probeStorageReachable()) === true, "有响应(含 opaque)→ connected");
      // network-layer reject (TypeError) → disconnected.
      globalThis.fetch = (async () => {
        throw new TypeError("Failed to fetch");
      }) as typeof fetch;
      assert((await probeStorageReachable()) === false, "TypeError 无响应 → disconnected");
      // no env → can't probe → don't false-alarm.
      delete process.env.NEXT_PUBLIC_APP_SUPABASE_URL;
      assert((await probeStorageReachable()) === true, "无 URL 配置 → true(不误报)");
    } finally {
      globalThis.fetch = origFetch;
      process.env.NEXT_PUBLIC_APP_SUPABASE_URL = origUrl;
    }
  }

  console.log(`\n── 失败文件一键重传:只补失败、复用 productId、不重建已成功 ──\n`);
  {
    const f = (name: string) => new File([new Uint8Array(8)], name);
    const card = {
      cardId: "card-1",
      photos: [f("a.jpg"), f("b.jpg")],
      photoTypes: ["product", "reference"],
      glbFile: f("m.glb"),
      glbBudget: { sizeKb: 100, vertexCount: 200, maxTextureDim: 1024, decodedRamMb: 10 },
      fbxFile: null,
      fbxIsZip: false,
      textureFiles: [],
      realDimensions: { length: 100, width: 50, height: 30 },
      itemType: "faucet",
      subtypeSlug: null,
      roomSlugs: ["bathroom"],
      supplierIds: ["sup-1"],
    } as DraftCardState;

    const up = initCardUpload(card);
    assert(
      typeof up.productId === "string" && up.productId.length > 0 &&
        up.photos.length === 2 && up.photos.every((p) => p === null) &&
        up.glbPath === null && up.status === "pending",
      "初始:productId 已铸、2 图 + glb 全待传",
    );
    assert(countPendingFiles(card, up) === 3, "待传文件 = 3(2 图 + 1 glb)");

    // Simulate photo0 + glb succeeding on the first (partial) run.
    up.photos[0] = { imageId: "img0", ext: "jpg", type: "product" };
    up.glbPath = "products/x/model.glb";
    assert(countPendingFiles(card, up) === 1, "photo0+glb 成功后 → 只剩 1 个待传(已成功的不再动)");

    // productId is reused across the refill — same object, same id.
    const idBefore = up.productId;
    up.photos[1] = { imageId: "img1", ext: "jpg", type: "reference" };
    assert(up.productId === idBefore, "重传全程复用同一 productId(不新建产品行)");
    assert(countPendingFiles(card, up) === 0, "全部补齐 → 0 待传");

    const fd = buildCardFd(card, up);
    assert(fd.get("glb_path") === "products/x/model.glb", "buildFd 复用已存 glb_path(不重传)");
    assert(fd.get("glb_size_kb") === "100", "glb 元数据齐");
    assert(
      fd.get("raw_image_entries") === JSON.stringify([{ imageId: "img0", ext: "jpg" }]),
      "product 图进 raw_image_entries",
    );
    assert(
      fd.get("real_photo_entries") === JSON.stringify([{ imageId: "img1", ext: "jpg" }]),
      "reference 图进 real_photo_entries",
    );

    // Two fresh inits → two distinct productIds (each card is its own row).
    assert(
      initCardUpload(card).productId !== initCardUpload(card).productId,
      "每张卡各自铸造独立 productId",
    );
  }

  console.log(`\n${failures === 0 ? "✓ ALL PASS" : `✗ ${failures} FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
