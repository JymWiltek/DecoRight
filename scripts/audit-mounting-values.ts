/**
 * One-off mounting-value health check (PB #33 task 1). Scans every product's
 * attributes.mounting and reports any value that is neither a canonical
 * MOUNTING_SCENE_RULES key NOR a MOUNTING_ALIASES synonym — those are the values
 * that silently generate WITHOUT an installation constraint. REPORT ONLY: no
 * product data is modified. Writes docs/mounting-audit-2026-07-28.md.
 *
 * Run: NODE_OPTIONS='' npx tsx --env-file=.env.local scripts/audit-mounting-values.ts
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
const ALIASES = MOUNTING_ALIASES; // value → canonical

type Row = { id: string; name: string | null; sku_id: string | null; item_type: string | null; attributes: Record<string, unknown> | null };

async function main() {
  const { data, error } = await sb
    .from("products")
    .select("id,name,sku_id,item_type,attributes");
  if (error) throw error;
  const rows = (data ?? []) as Row[];

  const counts = new Map<string, number>();
  const unknownProducts = new Map<string, Row[]>();
  let withMounting = 0;

  for (const r of rows) {
    const raw = r.attributes?.mounting;
    const m = typeof raw === "string" ? raw.trim() : "";
    if (!m) continue;
    withMounting++;
    counts.set(m, (counts.get(m) ?? 0) + 1);
    const known = STANDARD.has(m) || m in ALIASES;
    if (!known) {
      const list = unknownProducts.get(m) ?? [];
      list.push(r);
      unknownProducts.set(m, list);
    }
  }

  const L: string[] = [];
  L.push("# Mounting 值体检 — 2026-07-28(仅举报,不修数据)");
  L.push("");
  L.push(
    "由 `scripts/audit-mounting-values.ts` 生成。检查 `products.attributes.mounting` 是否落在" +
      "**标准枚举**(`MOUNTING_SCENE_RULES` 键)或**别名表**(`MOUNTING_ALIASES`)内。落在别名表的值会被" +
      "`resolveMountingRule` 归一到规范键;两者都不在的值会 resolve 成 `unknown` → 生成时**无安装约束**。",
  );
  L.push("");
  L.push(`- 产品总数:${rows.length}`);
  L.push(`- 有 mounting 值的产品:${withMounting}`);
  L.push(`- 标准枚举键:${[...STANDARD].map((k) => `\`${k}\``).join(", ")}`);
  L.push(
    `- 别名映射:${Object.entries(ALIASES).map(([a, c]) => `\`${a}\`→\`${c}\``).join(", ") || "(无)"}`,
  );
  L.push("");

  L.push("## 值分布");
  L.push("");
  L.push("| mounting 值 | 数量 | 状态 |");
  L.push("| --- | ---: | --- |");
  for (const [v, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    const status = STANDARD.has(v)
      ? "✅ 标准"
      : v in ALIASES
        ? `🔁 别名 → \`${ALIASES[v]}\``
        : "⚠️ 未知(无规则,生成无安装约束)";
    L.push(`| \`${v}\` | ${n} | ${status} |`);
  }
  L.push("");

  L.push("## ⚠️ 未知值产品清单(需补别名或修 taxonomy)");
  L.push("");
  if (unknownProducts.size === 0) {
    L.push("**无。** 所有 mounting 值都在标准枚举或别名表内。");
  } else {
    for (const [v, list] of unknownProducts.entries()) {
      L.push(`### \`${v}\`(${list.length} 个)`);
      L.push("");
      for (const p of list) {
        L.push(
          `- ${p.name ?? "(无名)"} — sku=\`${p.sku_id ?? "-"}\` item_type=\`${p.item_type ?? "-"}\` id=\`${p.id.slice(0, 8)}\``,
        );
      }
      L.push("");
    }
  }

  const DOC = "docs/mounting-audit-2026-07-28.md";
  writeFileSync(DOC, L.join("\n"));
  console.log(
    `✓ wrote ${DOC} — ${counts.size} distinct values, ${unknownProducts.size} unknown`,
  );
}

main().catch((e) => {
  console.error("ERR", e);
  process.exit(1);
});
