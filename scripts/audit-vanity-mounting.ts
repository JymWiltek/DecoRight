/**
 * One-off vanity/basin mounting-value audit (PB). REPORT ONLY — no data changes,
 * no alias-table changes. Scans every item_type in VANITY_BASIN_TYPES
 * (bathroom_vanity / vanity / basin) for attributes.mounting and reports: value
 * distribution (per item_type + overall), empty-value products, and non-standard
 * values (not a MOUNTING_SCENE_RULES key nor a MOUNTING_ALIASES synonym) with a
 * SUGGESTED mapping for Jym to rule on. Writes
 * docs/vanity-mounting-audit-2026-08-06.md. Same format as the faucet audit (#38).
 *
 * Run: npx tsx --env-file=.env.local scripts/audit-vanity-mounting.ts
 */
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  MOUNTING_SCENE_RULES,
  MOUNTING_ALIASES,
  VANITY_BASIN_TYPES,
} from "../config/mounting-scene-rules";

const url = process.env.NEXT_PUBLIC_APP_SUPABASE_URL!;
const key = process.env.APP_SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(url, key, { auth: { persistSession: false } });

const STANDARD = new Set(Object.keys(MOUNTING_SCENE_RULES));
const TYPES = [...VANITY_BASIN_TYPES];

/** Best-guess canonical for a non-standard value, for Jym to accept/reject. */
function suggest(v: string): string {
  const m = v.toLowerCase();
  if (/wall|hung/.test(m)) return "wall_mounted";
  if (/counter|top|vessel|bench/.test(m)) return "counter_top";
  if (/free|floor|stand/.test(m)) return "floor_standing";
  if (/semi|recess/.test(m)) return "semi_recessed";
  return "(需 Jym 裁定)";
}

type Row = {
  id: string;
  name: string | null;
  sku_id: string | null;
  item_type: string | null;
  attributes: Record<string, unknown> | null;
};

async function main() {
  const { data, error } = await sb
    .from("products")
    .select("id,name,sku_id,item_type,attributes")
    .in("item_type", TYPES);
  if (error) throw error;
  const rows = (data ?? []) as Row[];

  const counts = new Map<string, number>();
  const byType = new Map<string, { total: number; empty: number }>();
  const empties: Row[] = [];
  const nonStd = new Map<string, Row[]>();

  for (const r of rows) {
    const t = r.item_type ?? "(null)";
    const bt = byType.get(t) ?? { total: 0, empty: 0 };
    bt.total++;
    const raw = r.attributes?.mounting;
    const m = typeof raw === "string" ? raw.trim() : "";
    if (!m) {
      bt.empty++;
      empties.push(r);
      counts.set("(empty)", (counts.get("(empty)") ?? 0) + 1);
      byType.set(t, bt);
      continue;
    }
    byType.set(t, bt);
    counts.set(m, (counts.get(m) ?? 0) + 1);
    if (!STANDARD.has(m) && !(m in MOUNTING_ALIASES)) {
      const list = nonStd.get(m) ?? [];
      list.push(r);
      nonStd.set(m, list);
    }
  }

  const L: string[] = [];
  L.push("# Vanity/Basin mounting 值查证 — 2026-08-06(仅举报,不修数据/不改别名表)");
  L.push("");
  L.push(
    "由 `scripts/audit-vanity-mounting.ts` 生成。vanity/basin 的**龙头 + 镜子**已是**必配铁律**" +
      "(不依赖 mounting 命中),本查证用于确认 mounting 为空/非标的产品,供 Jym 裁定是否补别名或补值。" +
      "注意:mounting 影响的是**结构约束**(挂墙→无腿悬空 / 落地→触地),空值时结构铁律只保留「部件相连、有支撑」基线。",
  );
  L.push("");
  L.push(`- 覆盖 item_type:${TYPES.map((t) => `\`${t}\``).join(", ")}`);
  L.push(`- 产品总数:${rows.length}`);
  L.push(`- mounting 为空:${empties.length}`);
  L.push(`- 标准枚举键:${[...STANDARD].map((k) => `\`${k}\``).join(", ")}`);
  L.push(
    `- 别名映射:${Object.entries(MOUNTING_ALIASES).map(([a, c]) => `\`${a}\`→\`${c}\``).join(", ") || "(无)"}`,
  );
  L.push("");

  L.push("## 各 item_type 空值率");
  L.push("");
  L.push("| item_type | 总数 | 空 mounting |");
  L.push("| --- | ---: | ---: |");
  for (const t of TYPES) {
    const bt = byType.get(t) ?? { total: 0, empty: 0 };
    L.push(`| \`${t}\` | ${bt.total} | ${bt.empty} |`);
  }
  L.push("");

  L.push("## 值分布(总)");
  L.push("");
  L.push("| mounting 值 | 数量 | 状态 |");
  L.push("| --- | ---: | --- |");
  for (const [v, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    const status =
      v === "(empty)"
        ? "⚪ 空(结构铁律降级为基线)"
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
        L.push(`- [${p.item_type}] ${p.name ?? "(无名)"} — sku=\`${p.sku_id ?? "-"}\` id=\`${p.id.slice(0, 8)}\``);
      }
      L.push("");
    }
  }

  if (empties.length > 0) {
    L.push("## 空值产品清单(结构铁律降级为基线,可选补值)");
    L.push("");
    for (const p of empties) {
      L.push(`- [${p.item_type}] ${p.name ?? "(无名)"} — sku=\`${p.sku_id ?? "-"}\` id=\`${p.id.slice(0, 8)}\``);
    }
    L.push("");
  }

  const DOC = "docs/vanity-mounting-audit-2026-08-06.md";
  writeFileSync(DOC, L.join("\n"));
  console.log(
    `✓ wrote ${DOC} — ${rows.length} vanity/basin, ${empties.length} empty, ${nonStd.size} non-standard values`,
  );
}

main().catch((e) => {
  console.error("ERR", e);
  process.exit(1);
});
