/**
 * One-off faucet mounting-value audit (PB). REPORT ONLY — no data changes, no
 * alias-table changes. Scans every item_type='faucet' product's
 * attributes.mounting and reports: value distribution, empty-value products, and
 * non-standard values (not a MOUNTING_SCENE_RULES key nor a MOUNTING_ALIASES
 * synonym) with a SUGGESTED mapping for Jym to rule on. Writes
 * docs/faucet-mounting-audit-2026-08-01.md.
 *
 * Run: NODE_OPTIONS='' npx tsx --env-file=.env.local scripts/audit-faucet-mounting.ts
 */
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  MOUNTING_SCENE_RULES,
  MOUNTING_ALIASES,
} from "../config/mounting-scene-rules";

const url = process.env.NEXT_PUBLIC_APP_SUPABASE_URL!;
const key = process.env.APP_SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(url, key, { auth: { persistSession: false } });

const STANDARD = new Set(Object.keys(MOUNTING_SCENE_RULES));

/** Best-guess canonical for a non-standard value, for Jym to accept/reject. */
function suggest(v: string): string {
  const m = v.toLowerCase();
  if (/wall|hung/.test(m)) return "wall_mounted";
  if (/deck|counter|top|bench/.test(m)) return "deck_mounted";
  return "(需 Jym 裁定)";
}

type Row = { id: string; name: string | null; sku_id: string | null; attributes: Record<string, unknown> | null };

async function main() {
  const { data, error } = await sb
    .from("products")
    .select("id,name,sku_id,attributes")
    .eq("item_type", "faucet");
  if (error) throw error;
  const rows = (data ?? []) as Row[];

  const counts = new Map<string, number>();
  const empties: Row[] = [];
  const nonStd = new Map<string, Row[]>();

  for (const r of rows) {
    const raw = r.attributes?.mounting;
    const m = typeof raw === "string" ? raw.trim() : "";
    if (!m) {
      empties.push(r);
      counts.set("(empty)", (counts.get("(empty)") ?? 0) + 1);
      continue;
    }
    counts.set(m, (counts.get(m) ?? 0) + 1);
    if (!STANDARD.has(m) && !(m in MOUNTING_ALIASES)) {
      const list = nonStd.get(m) ?? [];
      list.push(r);
      nonStd.set(m, list);
    }
  }

  const L: string[] = [];
  L.push("# Faucet mounting 值查证 — 2026-08-01(仅举报,不修数据/不改别名表)");
  L.push("");
  L.push(
    "由 `scripts/audit-faucet-mounting.ts` 生成。faucet 类的盆承接已是**无条件铁律**(不依赖 " +
      "mounting 命中),本查证用于确认哪些 faucet 的 mounting 为空/非标,供 Jym 裁定是否补别名或补值。",
  );
  L.push("");
  L.push(`- faucet 产品总数:${rows.length}`);
  L.push(`- mounting 为空:${empties.length}`);
  L.push(`- 标准枚举键:${[...STANDARD].map((k) => `\`${k}\``).join(", ")}`);
  L.push(
    `- 别名映射:${Object.entries(MOUNTING_ALIASES).map(([a, c]) => `\`${a}\`→\`${c}\``).join(", ") || "(无)"}`,
  );
  L.push("");

  L.push("## 值分布");
  L.push("");
  L.push("| mounting 值 | 数量 | 状态 |");
  L.push("| --- | ---: | --- |");
  for (const [v, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    const status =
      v === "(empty)"
        ? "⚪ 空(铁律仍生效)"
        : STANDARD.has(v)
          ? "✅ 标准"
          : v in MOUNTING_ALIASES
            ? `🔁 别名 → \`${MOUNTING_ALIASES[v]}\``
            : `⚠️ 非标 —— 建议映射 \`${suggest(v)}\``;
    L.push(`| \`${v}\` | ${n} | ${status} |`);
  }
  L.push("");

  L.push("## ⚠️ 非标值产品清单(建议映射,等 Jym 裁定)");
  L.push("");
  if (nonStd.size === 0) {
    L.push("**无非标值。**");
  } else {
    for (const [v, list] of nonStd.entries()) {
      L.push(`### \`${v}\` → 建议 \`${suggest(v)}\`(${list.length} 个)`);
      L.push("");
      for (const p of list) {
        L.push(`- ${p.name ?? "(无名)"} — sku=\`${p.sku_id ?? "-"}\` id=\`${p.id.slice(0, 8)}\``);
      }
      L.push("");
    }
  }

  if (empties.length > 0) {
    L.push("## 空值 faucet 清单(铁律照常生效,可选补值)");
    L.push("");
    for (const p of empties) {
      L.push(`- ${p.name ?? "(无名)"} — sku=\`${p.sku_id ?? "-"}\` id=\`${p.id.slice(0, 8)}\``);
    }
    L.push("");
  }

  const DOC = "docs/faucet-mounting-audit-2026-08-01.md";
  writeFileSync(DOC, L.join("\n"));
  console.log(
    `✓ wrote ${DOC} — ${rows.length} faucets, ${empties.length} empty, ${nonStd.size} non-standard values`,
  );
}

main().catch((e) => {
  console.error("ERR", e);
  process.exit(1);
});
