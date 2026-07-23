# 列表页图片性能 — 审计与修复(2026-07-23)

## 审计(先审计后动手,用数据定位真因)

抓生产 `https://deco-right.vercel.app/c/toilet`,CDP 记录每个图片请求的真实传输大小(4G 限速 = 4 Mbps / 50 ms RTT / 4×CPU):

| 来源 | 张数 | 传输 | 说明 |
| --- | ---: | ---: | --- |
| `/api/card-image/*`(卡片图) | 24 | 492 KB(均 20.5 KB,最大 26 KB)| 已是 600px WebP,**本就达标** |
| 直连 Supabase 原图 PNG | 7 | **15.25 MB**(每张 ~2.1–2.3 MB)| **真凶** |
| `/_next/image` | 0 | — | 全站没走 next/image |

**真因(与"卡片图未压缩"的猜测不同):** 全局 `SiteHeader` 的 mega-menu 下拉把 7 个类目封面用 `<img src={原图}>` 直接加载 —— 原始 ~2 MB 场景 PNG,却只显示在 **64×64px**,且无懒加载。header 在每一页,所以每次访问都白拉 15 MB。卡片图(走 `/api/card-image`)本来就是 ~20 KB WebP,不是瓶颈。

## 修复(精准修复 + 全站 next/image)

- `next.config.ts` 加 `images.remotePatterns`(Supabase Storage 域)+ AVIF/WebP。
- 所有 raw `<img src={原图}>` 的门面图改 `next/image`:mega-menu 封面、`ItemTypeCoverCard`、`RoomCard`、home hero、room hero、featured/bundle 封面、`ProductGallery` 主图与缩略图、`ModelFallback`。Vercel 按显示尺寸出 AVIF/WebP 并在边缘缓存;原图一张不删。
- masonry 卡片保留 `/api/card-image`(带白边裁剪 + 已 ~20 KB,next/image 无法替代裁剪),已满足 缩略档 + 懒加载 + 灰底占位。
- 详情页主图取 medium(next/image `sizes`),原图仍在 storage。

## 前后对比(同一 4G 限速)

| 指标 | 修复前(prod) | 修复后(本地 prod build) |
| --- | ---: | ---: |
| 图片总传输 | **15.75 MB** | **534 KB**(↓ 30×)|
| **LCP** | 4784 ms | **1520 ms**(< 2s ✅)|
| 直连原图 PNG | 7 张 / 15.25 MB | **0** |
| next/image | 0 | 7 张 AVIF(1.4–1.8 KB / 张)|
| 单张卡片图最大 | 26 KB | 26 KB(≤ 100 KB ✅)|

mega-menu 的 7 张封面:**~2 MB → 1.4–1.8 KB / 张**(AVIF)。

> 硬指标达成:4G LCP 1.52s < 2s;单图 ≤ 26 KB < 100 KB。本地 prod build 无 CDN,生产上 next/image + card-image 均边缘缓存,只会更快。
