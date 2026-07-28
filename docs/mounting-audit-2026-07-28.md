# Mounting 值体检 — 2026-07-28(仅举报,不修数据)

由 `scripts/audit-mounting-values.ts` 生成。检查 `products.attributes.mounting` 是否落在**标准枚举**(`MOUNTING_SCENE_RULES` 键)或**别名表**(`MOUNTING_ALIASES`)内。落在别名表的值会被`resolveMountingRule` 归一到规范键;两者都不在的值会 resolve 成 `unknown` → 生成时**无安装约束**。

- 产品总数:256
- 有 mounting 值的产品:124
- 标准枚举键:`wall_mounted`, `counter_top`, `semi_recessed`, `floor_standing`, `deck_mounted`, `built_in`, `corner`
- 别名映射:`wall_hung`→`wall_mounted`

## 值分布

| mounting 值 | 数量 | 状态 |
| --- | ---: | --- |
| `counter_top` | 39 | ✅ 标准 |
| `wall_mounted` | 37 | ✅ 标准 |
| `floor_standing` | 27 | ✅ 标准 |
| `deck_mounted` | 11 | ✅ 标准 |
| `wall_hung` | 7 | 🔁 别名 → `wall_mounted` |
| `semi_recessed` | 2 | ✅ 标准 |
| `built_in` | 1 | ✅ 标准 |

## ⚠️ 未知值产品清单(需补别名或修 taxonomy)

**无。** 所有 mounting 值都在标准枚举或别名表内。