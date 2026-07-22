/**
 * Whole-catalog data-quality audit — READ-ONLY.
 *
 * Companion to the scene publish-gate change. The gate closes the "publish a
 * product with zero scene images" hole going forward; this script scans the
 * WHOLE catalog (published + draft + archived) for that gap and every other
 * data hole, so Jym sees the full backlog and can drive fixes by category
 * (toilet first). It NEVER writes — pure SELECTs.
 *
 * Every check REUSES the app's own logic so the report can't drift from what
 * the product actually enforces:
 *   • scene           → isSceneCoverUrl              (src/lib/scene-cover-url)
 *   • suspicious dims  → guardDimensions + caps      (the same 26-flag logic)
 *   • name conflicts   → findNameConflict (#22)      (config/name-conflict-rules)
 *   • placeholder name → isUnnamedProduct            (src/lib/admin/product-validation)
 *
 * Run (server-only modules need the react-server condition):
 *   NODE_OPTIONS='--conditions=react-server' \
 *     npx tsx --env-file=.env.local scripts/audit-quality.ts
 *
 * Output: docs/audit-2026-07-22.md (overwritten each run).
 */
import { writeFileSync } from "node:fs";
import { createServiceRoleClient } from "../src/lib/supabase/service";
import { isSceneCoverUrl } from "../src/lib/scene-cover-url";
import { findNameConflict } from "../config/name-conflict-rules";
import { guardDimensions } from "../src/lib/admin/dimension-guard";
import { isUnnamedProduct } from "../src/lib/admin/product-validation";

const REPORT_PATH = "docs/audit-2026-07-22.md";
const REPORT_DATE = "2026-07-22";

type P = {
  id: string;
  name: string | null;
  item_type: string | null;
  status: string | null;
  thumbnail_url: string | null;
  dimensions_mm: { length?: number; width?: number; height?: number } | null;
  sku_id: string | null;
  price_myr: number | null;
  fbx_url: string | null;
  fbx_bundle_url: string | null;
  attributes: Record<string, unknown> | null;
};

const isBlank = (s: string | null | undefined) => !((s ?? "").trim());
const typeOf = (p: P) => p.item_type ?? "(untyped)";
const normName = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

const mountingOf = (p: P): string | null => {
  const m = p.attributes && typeof p.attributes === "object"
    ? (p.attributes as Record<string, unknown>).mounting
    : null;
  return typeof m === "string" && m.trim() ? m.trim() : null;
};

const hasAnyDim = (d: P["dimensions_mm"]) =>
  !!d && [d.length, d.width, d.height].some((v) => typeof v === "number" && v > 0);

const suspiciousDims = (p: P) =>
  guardDimensions(p.dimensions_mm, p.item_type).warnings.some((w) =>
    w.includes("exceeds"),
  );

async function main() {
  const supabase = createServiceRoleClient();

  // ── read (two SELECTs, no writes) ──────────────────────────────────────
  const { data: rawProducts, error: pErr } = await supabase
    .from("products")
    .select(
      "id,name,item_type,status,thumbnail_url,dimensions_mm,sku_id,price_myr,fbx_url,fbx_bundle_url,attributes",
    );
  if (pErr) throw pErr;
  const products = (rawProducts ?? []) as unknown as P[];

  const { data: supLinks, error: sErr } = await supabase
    .from("product_suppliers")
    .select("product_id");
  if (sErr) throw sErr;
  const supplierCount: Record<string, number> = {};
  for (const l of supLinks ?? []) {
    supplierCount[l.product_id] = (supplierCount[l.product_id] ?? 0) + 1;
  }

  // ── per-row checks (each REUSES the app's own predicate) ───────────────
  type Check = { key: string; label: string; test: (p: P) => boolean };
  const CHECKS: Check[] = [
    { key: "no_scene", label: "无场景图", test: (p) => !isSceneCoverUrl(p.thumbnail_url) },
    { key: "no_mounting", label: "缺 mounting", test: (p) => !mountingOf(p) },
    { key: "no_dims", label: "缺 dimensions_mm", test: (p) => !hasAnyDim(p.dimensions_mm) },
    { key: "suspicious_dims", label: "尺寸可疑 (超类目上限)", test: suspiciousDims },
    { key: "no_sku", label: "缺 SKU", test: (p) => isBlank(p.sku_id) },
    { key: "no_retailer", label: "缺 retailer", test: (p) => (supplierCount[p.id] ?? 0) === 0 },
    { key: "no_price", label: "缺价格", test: (p) => p.price_myr == null },
    { key: "no_fbx", label: "缺 FBX", test: (p) => !p.fbx_url && !p.fbx_bundle_url },
    { key: "name_conflict", label: "名字含互斥安装词 (#22)", test: (p) => !!findNameConflict(p.name) },
    { key: "placeholder_name", label: "占位名残留 (Untitled product)", test: (p) => isUnnamedProduct(p.name) },
  ];

  const matches: Record<string, P[]> = {};
  for (const c of CHECKS) matches[c.key] = products.filter(c.test);

  // ── status split ───────────────────────────────────────────────────────
  const byStatus = (list: P[], s: string) => list.filter((p) => p.status === s);
  const statusCounts: Record<string, number> = {};
  for (const p of products) {
    const s = p.status ?? "(none)";
    statusCounts[s] = (statusCounts[s] ?? 0) + 1;
  }
  const statusSummary = Object.keys(statusCounts)
    .sort()
    .map((s) => `${s} ${statusCounts[s]}`)
    .join(" · ");

  // ── item_type universe (sorted, biggest first) ─────────────────────────
  const typeTotals: Record<string, number> = {};
  for (const p of products) typeTotals[typeOf(p)] = (typeTotals[typeOf(p)] ?? 0) + 1;
  const types = Object.keys(typeTotals).sort(
    (a, b) => typeTotals[b] - typeTotals[a] || a.localeCompare(b),
  );

  // ── duplicates (name-normalized groups >1, and SKU groups >1) ──────────
  const nameGroups = new Map<string, P[]>();
  for (const p of products) {
    const k = normName(p.name);
    if (!k || isUnnamedProduct(p.name)) continue; // placeholders handled elsewhere
    const g = nameGroups.get(k) ?? [];
    g.push(p);
    nameGroups.set(k, g);
  }
  const dupNames = [...nameGroups.values()].filter((g) => g.length > 1);

  const skuGroups = new Map<string, P[]>();
  for (const p of products) {
    const k = (p.sku_id ?? "").trim().toLowerCase();
    if (!k) continue;
    const g = skuGroups.get(k) ?? [];
    g.push(p);
    skuGroups.set(k, g);
  }
  const dupSkus = [...skuGroups.values()].filter((g) => g.length > 1);

  // ── render ──────────────────────────────────────────────────────────────
  const L: string[] = [];
  const line = (s = "") => L.push(s);
  const row = (p: P) => `  - \`${p.id}\` — ${p.name ?? "(no name)"} · _${p.status ?? "?"}_`;

  line(`# DecoRight 全库数据体检 — ${REPORT_DATE}`);
  line();
  line(
    `只读扫描,零写入、零 AI 调用。脚本 \`scripts/audit-quality.ts\`,可随时重跑。`,
  );
  line();
  line(
    `产品总数 **${products.length}**(${statusSummary})。本报告只报告、不自动修复。`,
  );
  line();

  // Summary table A — per-problem totals
  line(`## 汇总:每类问题数量`);
  line();
  line(`| 问题 | 数量 | 其中 published | 其中 draft |`);
  line(`| --- | ---: | ---: | ---: |`);
  for (const c of CHECKS) {
    const m = matches[c.key];
    line(
      `| ${c.label} | ${m.length} | ${byStatus(m, "published").length} | ${byStatus(m, "draft").length} |`,
    );
  }
  line(`| 疑似重复:名字归一后撞名 | ${dupNames.length} 组 | — | — |`);
  line(`| 疑似重复:SKU 撞号 | ${dupSkus.length} 组 | — | — |`);
  line();

  // Summary table B — item_type × problem matrix
  line(`## 汇总:按 item_type 分布`);
  line();
  line(`> Jym 按类目推进(先 toilet)。每格是该类目命中该问题的产品数。`);
  line();
  const head = ["item_type", "总数", ...CHECKS.map((c) => c.label)];
  line(`| ${head.join(" | ")} |`);
  line(`| ${head.map((_, i) => (i < 2 ? "---" : "---:")).join(" | ")} |`);
  for (const t of types) {
    const cells = CHECKS.map(
      (c) => matches[c.key].filter((p) => typeOf(p) === t).length,
    );
    line(`| ${t} | ${typeTotals[t]} | ${cells.join(" | ")} |`);
  }
  line();

  // Per-section detail
  const section = (title: string, list: P[], groupByType = true) => {
    line(`## ${title} — ${list.length}`);
    line();
    if (list.length === 0) {
      line(`_无。_`);
      line();
      return;
    }
    if (!groupByType) {
      for (const p of list) line(row(p));
      line();
      return;
    }
    const present = types.filter((t) => list.some((p) => typeOf(p) === t));
    for (const t of present) {
      const rows = list.filter((p) => typeOf(p) === t);
      line(`- **${t}** (${rows.length})`);
      for (const p of rows) line(row(p));
    }
    line();
  };

  // No-scene: published and draft split out (the published batch is today's leak)
  const noScene = matches["no_scene"];
  line(`## 无场景图 — ${noScene.length}`);
  line();
  line(
    `> 场景图 = thumbnail 是 \`/scene-\` 图。发布闸新增此项后,draft 无场景图不可发布;published 这批是闸生效前漏出去的(既往不咎,不自动下架)。`,
  );
  line();
  const nsPub = byStatus(noScene, "published");
  const nsDraft = byStatus(noScene, "draft");
  const nsOther = noScene.filter((p) => p.status !== "published" && p.status !== "draft");
  section(`↳ published(前台可见,今天漏出去的半成品)`, nsPub);
  section(`↳ draft(闸生效后不可发布)`, nsDraft);
  if (nsOther.length) section(`↳ 其它状态(archived 等)`, nsOther);

  // The rest
  section("缺 mounting(attributes.mounting 空)", matches["no_mounting"]);
  section("缺 dimensions_mm", matches["no_dims"]);
  section("尺寸可疑(某轴超 config/dimension-caps 上限)", matches["suspicious_dims"]);
  section("缺 SKU", matches["no_sku"]);
  section("缺 retailer(零 product_suppliers 关联)", matches["no_retailer"]);
  section("缺价格(price_myr 空)", matches["no_price"]);
  section("缺 FBX(fbx_url 与 fbx_bundle_url 都空)", matches["no_fbx"]);
  section("名字含互斥安装词(#22 findNameConflict)", matches["name_conflict"]);
  section("占位名残留(Untitled product / Untitled)", matches["placeholder_name"]);

  // Duplicates
  line(`## 疑似重复:名字归一后撞名 — ${dupNames.length} 组`);
  line();
  if (dupNames.length === 0) line(`_无。_`);
  for (const g of dupNames.sort((a, b) => b.length - a.length)) {
    line(`- **${g[0].name}** ×${g.length}`);
    for (const p of g) line(row(p));
  }
  line();

  line(`## 疑似重复:SKU 撞号 — ${dupSkus.length} 组`);
  line();
  if (dupSkus.length === 0) line(`_无。_`);
  for (const g of dupSkus.sort((a, b) => b.length - a.length)) {
    line(`- **SKU \`${g[0].sku_id}\`** ×${g.length}`);
    for (const p of g) line(row(p));
  }
  line();

  writeFileSync(REPORT_PATH, L.join("\n"));
  console.log(`✓ wrote ${REPORT_PATH}`);
  console.log(`  products scanned: ${products.length}`);
  for (const c of CHECKS) console.log(`  ${c.label}: ${matches[c.key].length}`);
  console.log(`  dup names: ${dupNames.length} groups · dup SKUs: ${dupSkus.length} groups`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
