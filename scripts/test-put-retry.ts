/**
 * Unit test for the byte-PUT auto-retry decision (PB). Exercises the REAL
 * exported putWithNetworkRetry / putRetryExhaustedNote from lib/upload-trace
 * with a mock `attempt()` — NO network, NO browser, net-zero, 0 OpenAI.
 * Injects a no-op sleep (captures the delays) so it runs instantly.
 *
 * Run:  npx tsx scripts/test-put-retry.ts
 */
import {
  putWithNetworkRetry,
  putRetryExhaustedNote,
  PUT_RETRY_DELAYS_MS,
  type PutAttemptResult,
} from "../src/lib/upload-trace";

let failures = 0;
function assert(cond: boolean, label: string) {
  console.log(`   ${cond ? "✓" : "✗ FAIL"} ${label}`);
  if (!cond) failures++;
}

/** A scripted attempt(): returns the given outcomes in order, one per call. */
function scripted(outcomes: PutAttemptResult[]): () => Promise<PutAttemptResult> {
  let i = 0;
  return async () => outcomes[Math.min(i++, outcomes.length - 1)];
}

(async () => {
  console.log(`\n── retry policy: ${PUT_RETRY_DELAYS_MS.length} retries, delays ${PUT_RETRY_DELAYS_MS.join("/")}ms ──\n`);

  // ① first PUT network-drops, retry succeeds → continues, retry=1.
  console.log("① 第一次网络断 → 自动重试 → 第二次成功");
  {
    const slept: number[] = [];
    const { result, retries } = await putWithNetworkRetry(
      scripted([
        { kind: "network-error", error: new TypeError("Failed to fetch") },
        { kind: "ok", status: 200 },
      ]),
      { sleep: async (ms) => void slept.push(ms) },
    );
    assert(result.kind === "ok", "最终成功");
    assert(retries === 1, `retry=1(实测 ${retries})`);
    assert(slept.length === 1 && slept[0] === 1000, `重试前等 1s(实测 ${slept.join("/")}ms)`);
  }

  // ② every PUT network-drops → 3 attempts, then structured failure.
  console.log("\n② 全部网络断 → 3 次后失败,文案含「已自动重试 2 次」");
  {
    const slept: number[] = [];
    let calls = 0;
    const { result, retries } = await putWithNetworkRetry(
      async () => {
        calls++;
        return { kind: "network-error", error: new TypeError("Failed to fetch") };
      },
      { sleep: async (ms) => void slept.push(ms) },
    );
    const note = putRetryExhaustedNote(false);
    console.log(`   attempts=${calls} · delays=${slept.join("/")}ms`);
    console.log(`   note: ${note}`);
    assert(result.kind === "network-error", "最终仍是网络层失败");
    assert(retries === 2, `retry=2(实测 ${retries})`);
    assert(calls === 3, `共 3 次尝试(1+2)(实测 ${calls})`);
    assert(slept.join("/") === "1000/3000", `间隔 1s/3s(实测 ${slept.join("/")}ms)`);
    assert(/已自动重试 2 次/.test(note), "失败文案含「已自动重试 2 次」");
    assert(/请检查网络后重传/.test(note), "失败文案含「请检查网络后重传」");
  }

  // ③ HTTP 413 → NO retry, immediate error (structural).
  console.log("\n③ HTTP 413 → 不重试,立即报错");
  {
    const slept: number[] = [];
    let calls = 0;
    const { result, retries } = await putWithNetworkRetry(
      async () => {
        calls++;
        return { kind: "http-error", status: 413, body: "Payload Too Large" };
      },
      { sleep: async (ms) => void slept.push(ms) },
    );
    assert(result.kind === "http-error" && result.status === 413, "返回 HTTP 413");
    assert(retries === 0, `零重试(实测 ${retries})`);
    assert(calls === 1, `只尝试 1 次(实测 ${calls})`);
    assert(slept.length === 0, "从未 sleep(未进入重试)");
  }

  // ④ normal: ok on first try → no retry, regression intact.
  console.log("\n④ 正常一次成功 → 零重试(回归)");
  {
    let calls = 0;
    const { result, retries } = await putWithNetworkRetry(async () => {
      calls++;
      return { kind: "ok", status: 200 };
    });
    assert(result.kind === "ok", "第一次即成功");
    assert(retries === 0 && calls === 1, `零重试、一次调用(实测 retry=${retries} calls=${calls})`);
  }

  console.log(`\n${failures === 0 ? "✓ ALL PASS" : `✗ ${failures} FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
