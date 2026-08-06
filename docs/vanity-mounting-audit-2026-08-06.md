# Vanity/Basin mounting 值查证 — 2026-08-06(仅举报,不修数据/不改别名表)

由 `scripts/audit-vanity-mounting.ts` 生成。vanity/basin 的**龙头 + 镜子**已是**必配铁律**(不依赖 mounting 命中),本查证用于确认 mounting 为空/非标的产品,供 Jym 裁定是否补别名或补值。注意:mounting 影响的是**结构约束**(挂墙→无腿悬空 / 落地→触地),空值时结构铁律只保留「部件相连、有支撑」基线。

- 覆盖 item_type:`bathroom_vanity`, `vanity`, `basin`
- 产品总数:82
- mounting 为空:10
- 标准枚举键:`wall_mounted`, `counter_top`, `semi_recessed`, `floor_standing`, `deck_mounted`, `built_in`, `corner`
- 别名映射:`wall_hung`→`wall_mounted`

## 各 item_type 空值率

| item_type | 总数 | 空 mounting |
| --- | ---: | ---: |
| `bathroom_vanity` | 35 | 8 |
| `vanity` | 3 | 2 |
| `basin` | 44 | 0 |

## 值分布(总)

| mounting 值 | 数量 | 状态 |
| --- | ---: | --- |
| `counter_top` | 38 | ✅ 标准 |
| `wall_hung` | 18 | 🔁 别名 → `wall_mounted` |
| `(empty)` | 10 | ⚪ 空(结构铁律降级为基线) |
| `floor_standing` | 9 | ✅ 标准 |
| `wall_mounted` | 5 | ✅ 标准 |
| `semi_recessed` | 2 | ✅ 标准 |

## ⚠️ 非标值产品清单(建议映射,等 Jym 裁定)

**无非标值。**
## 空值产品清单(结构铁律降级为基线,可选补值)

- [bathroom_vanity] White Bathroom Vanity — sku=`-` id=`918ed8d8`
- [bathroom_vanity] Bathroom Vanity Set — sku=`SWBC-SS6407` id=`a4785d4c`
- [bathroom_vanity] Square Bathroom Vanity — sku=`-` id=`7b720631`
- [bathroom_vanity] Bathroom Vanity Set — sku=`SWBC-SS6405` id=`3abd11ba`
- [bathroom_vanity] Bathroom Vanity Set — sku=`SWBC-SS6406` id=`c8996f65`
- [bathroom_vanity] Black Bathroom Vanity Set — sku=`WTK-BC5036/BLK` id=`9f9a289b`
- [vanity] LED Mirror Dressing Table — sku=`WDT-1908` id=`a2a2ab48`
- [vanity] Oval Mirror LED Dressing Table — sku=`WDT-1907` id=`ba8dc807`
- [bathroom_vanity] Black Bathroom Vanity — sku=`SWBC-A6619` id=`08d7bb50`
- [bathroom_vanity] Bathroom Vanity Set — sku=`SWBC-SS6615` id=`604ba713`
