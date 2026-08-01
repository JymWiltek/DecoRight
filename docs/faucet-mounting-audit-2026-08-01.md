# Faucet mounting 值查证 — 2026-08-01(仅举报,不修数据/不改别名表)

由 `scripts/audit-faucet-mounting.ts` 生成。faucet 类的盆承接已是**无条件铁律**(不依赖 mounting 命中),本查证用于确认哪些 faucet 的 mounting 为空/非标,供 Jym 裁定是否补别名或补值。

- faucet 产品总数:32
- mounting 为空:17
- 标准枚举键:`wall_mounted`, `counter_top`, `semi_recessed`, `floor_standing`, `deck_mounted`, `built_in`, `corner`
- 别名映射:`wall_hung`→`wall_mounted`

## 值分布

| mounting 值 | 数量 | 状态 |
| --- | ---: | --- |
| `(empty)` | 17 | ⚪ 空(铁律仍生效) |
| `deck_mounted` | 12 | ✅ 标准 |
| `wall_mounted` | 3 | ✅ 标准 |

## ⚠️ 非标值产品清单(建议映射,等 Jym 裁定)

**无非标值。**
## 空值 faucet 清单(铁律照常生效,可选补值)

- Black Kitchen Faucet — sku=`-` id=`e04f2cb5`
- Gold Faucet — sku=`-` id=`f8c795a3`
- Stainless Steel Kitchen Faucet — sku=`-` id=`19801982`
- Black Single Lever Faucet — sku=`-` id=`a2d12ad1`
- Black Kitchen Faucet — sku=`-` id=`5b460b38`
- Chrome Single Lever Faucet — sku=`-` id=`6f856543`
- Black Tall Faucet — sku=`-` id=`a16c0db9`
- Gold Tall Faucet — sku=`-` id=`032fd939`
- Rose Gold Faucet — sku=`-` id=`9c46621a`
- Black and Rose Gold Kitchen Tap — sku=`SRTWT5848-RG` id=`9172e056`
- Chrome Kitchen Mixer Tap — sku=`SRTKT962SS` id=`c2f856a8`
- Black and Gold Faucet — sku=`WTK-BASIN50` id=`d38489b0`
- Chrome Kitchen Faucet — sku=`SRTWT5821` id=`c3c612d7`
- Chrome Basin Mixer — sku=`WTK-BM05` id=`b2d90d6f`
- Gold Faucet — sku=`-` id=`dd927632`
- Black Tall Basin Faucet — sku=`-` id=`f9fad559`
- Pillar Sink Cold Tap — sku=`PKT02` id=`8dc6d811`
