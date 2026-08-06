/**
 * Publish-audit unit test (incident fix PR-A). Exercises the REAL exported
 * publishAudit. Net-zero, 0 OpenAI.
 *
 * Run: npx tsx scripts/test-publish-audit.ts
 */
import { publishAudit, type PublishSource } from "../src/lib/publish-gates";

let failures = 0;
function assert(cond: boolean, label: string) {
  console.log(`   ${cond ? "✓" : "✗ FAIL"} ${label}`);
  if (!cond) failures++;
}

(async () => {
  console.log("\n── publishAudit(source, now) ──\n");
  const now = new Date("2026-08-06T12:34:56.000Z");

  const m = publishAudit("manual", now);
  assert(m.published_by === "manual", "single/单产品 → published_by='manual'");
  assert(m.published_at === "2026-08-06T12:34:56.000Z", "published_at = ISO 时间戳");

  const b = publishAudit("bulk", now);
  assert(b.published_by === "bulk", "批量 → published_by='bulk'");

  // Only manual/bulk are valid sources — there is NO automatic source.
  const sources: PublishSource[] = ["manual", "bulk"];
  assert(
    sources.every((s) => publishAudit(s, now).published_by === s),
    "只有 manual/bulk 两个来源(无 auto)",
  );

  // Default now is a real Date (non-empty ISO).
  assert(
    /^\d{4}-\d{2}-\d{2}T/.test(publishAudit("manual").published_at),
    "默认 now 生成合法 ISO",
  );

  console.log(`\n${failures === 0 ? "✓ ALL PASS" : `✗ ${failures} FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
