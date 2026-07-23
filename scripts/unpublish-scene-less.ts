/**
 * One-time storefront cleanup — unpublish every PUBLISHED product that has NO
 * scene cover (isSceneCoverUrl(thumbnail_url) === false), by flipping its
 * status back to 'draft'. Jym's rule: the storefront must never show a
 * white-cutout-only product. These re-enter the normal publish flow the moment
 * a scene image is added (the scene gate from #25 then lets them through).
 *
 * SAFETY:
 *   • Dry-run by DEFAULT — prints the list + writes the record doc, NO DB writes.
 *   • Pass --run to actually flip status='published' → 'draft'.
 *   • Only the `status` column changes. Nothing is deleted.
 *
 * The record doc (docs/unpublished-2026-07-23.md) is written in both modes so
 * the exact set is captured for review and rollback.
 *
 * RESTORE (if ever needed): the doc lists every id. Re-publish via the admin
 * Publish flow (re-runs the gates), or, to bulk-revert verbatim:
 *   update public.products set status='published'
 *   where id in ( <ids from the doc> );
 *
 * Run:
 *   NODE_OPTIONS='--conditions=react-server' \
 *     npx tsx --env-file=.env.local scripts/unpublish-scene-less.ts          # dry-run
 *   NODE_OPTIONS='--conditions=react-server' \
 *     npx tsx --env-file=.env.local scripts/unpublish-scene-less.ts --run    # apply
 */
import { writeFileSync } from "node:fs";
import { createServiceRoleClient } from "../src/lib/supabase/service";
import { isSceneCoverUrl } from "../src/lib/scene-cover-url";

const DOC_PATH = "docs/unpublished-2026-07-23.md";
const APPLY = process.argv.includes("--run");

async function main() {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from("products")
    .select("id, name, item_type, thumbnail_url")
    .eq("status", "published");
  if (error) throw error;

  const targets = (data ?? [])
    .filter((p) => !isSceneCoverUrl(p.thumbnail_url))
    .sort((a, b) =>
      (a.item_type ?? "").localeCompare(b.item_type ?? "") ||
      (a.name ?? "").localeCompare(b.name ?? ""),
    );

  console.log(`published products without a scene cover: ${targets.length}`);
  console.log(APPLY ? "MODE: --run (will unpublish)" : "MODE: dry-run (no writes)");

  // group by item_type for the report
  const byType = new Map<string, typeof targets>();
  for (const p of targets) {
    const t = p.item_type ?? "(untyped)";
    const g = byType.get(t) ?? [];
    g.push(p);
    byType.set(t, g);
  }

  let applied = false;
  if (APPLY && targets.length > 0) {
    const ids = targets.map((p) => p.id);
    const { error: upErr } = await supabase
      .from("products")
      .update({ status: "draft" })
      .in("id", ids);
    if (upErr) throw upErr;
    applied = true;
    console.log(`✓ unpublished ${ids.length} products (status → draft)`);
  }

  // ── record doc ──
  const L: string[] = [];
  L.push(`# 下架名单 — 无场景图的已发布产品(2026-07-23)`);
  L.push("");
  L.push(
    applied
      ? `**已执行**:以下 ${targets.length} 个产品的 status 由 published 改为 draft。`
      : `**DRY-RUN(未执行)**:以下 ${targets.length} 个产品将被下架(status → draft)。加 \`--run\` 真跑。`,
  );
  L.push("");
  L.push(
    `判据:\`isSceneCoverUrl(thumbnail_url) === false\`(thumbnail 不是 /scene- 图)。补上场景图后走正常发布流程回归。仅改 \`status\` 字段,无删除。`,
  );
  L.push("");
  L.push(`回滚:\`update public.products set status='published' where id in (下列 id);\``);
  L.push("");
  L.push(`## 按类目`);
  L.push("");
  for (const [t, rows] of [...byType.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  )) {
    L.push(`### ${t} — ${rows.length}`);
    L.push("");
    for (const p of rows) L.push(`- \`${p.id}\` — ${p.name ?? "(no name)"}`);
    L.push("");
  }
  writeFileSync(DOC_PATH, L.join("\n"));
  console.log(`✓ wrote ${DOC_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
