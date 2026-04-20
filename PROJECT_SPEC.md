# DecoRight — 项目完整规格书

> 给 Claude Code 的完整项目说明
> 日期：2026-04-19
> 作者：Jym
> 版本：Final v1.1

---

## 一、项目是什么（一句话）

**马来西亚第一个真实可买家居产品的 AR 预览资料库——看到什么，就能买到什么。**

不是室内设计工具。不是 marketplace。不是 AI 生成图。

**是一个带结构化元数据的 3D 产品库 + 自动搭配引擎 + AR 预览。**

---

## 二、项目定位（心态层面）

- **长期资产**，不是短期商业项目
- 不追求快速变现
- 核心价值是**时间壁垒**：五年后马来西亚市场上没有任何人拥有像这样的真实可买产品 3D 数据库
- 所有交易跳外部链接（Wiltek 自家 + 其他供应商）——**不做电商平台，做展示库**

---

## 三、品牌信息

- **项目名称**：DecoRight
- **品牌含义**：Deco（装饰 / 室内）+ Right（对的选择）→ "选对装饰"
- **临时主色**：黑 (`#000000`) + 白 (`#FFFFFF`) + 点缀色 `#0EA5E9`（可后期调整）
- **临时字体**：Inter（Google Fonts 免费）
- **Logo**：第一阶段用文字 logo "DecoRight"，不做图形
- **语气**：亲切、实用、不浮夸

### 🔑 品牌名引用规则（重要）

**代码里所有涉及品牌名的地方，必须通过配置变量引用，不硬编码。**

创建 `config/brand.ts`：

```typescript
export const BRAND = {
  name: "DecoRight",
  tagline: "看到什么，就买到什么",
  email: "hello@decoright.my",
  domain: "decoright.my",
  // 其他品牌相关文案
}
```

**为什么这么做：** 未来如果要改名，只改这一个文件，全项目自动更新。

**内部代号保持不变：**
- Repo 名：`decoright`
- 数据库表名：不带品牌前缀（例如 `products`，不是 `decoright_products`）
- 环境变量前缀规则（**v1.2 明确**）：
  - **服务端变量**：`APP_` 前缀（例如 `APP_ADMIN_PASSWORD`、`APP_SUPABASE_SERVICE_ROLE_KEY`）
  - **客户端可见变量**：`NEXT_PUBLIC_APP_` 前缀（例如 `NEXT_PUBLIC_APP_SUPABASE_URL`、`NEXT_PUBLIC_APP_SUPABASE_ANON_KEY`）
  - 不使用 `DECORIGHT_` 前缀，品牌改名与代码零耦合

---

## 四、第一阶段目标（6 个月）

**一个硬指标：** 500 个真实可买的家居产品，每个都有：
- 3D 模型可旋转查看（压缩至 3-5MB）
- AR 模式可放进用户家里
- 完整结构化元数据（风格/色调/材质/尺寸/价格/颜色变体等）
- 可点击跳转购买

**不做的事（明确排除，避免 Claude Code 自行扩展）：**
- ❌ 用户账号系统
- ❌ 购物车 / 支付功能
- ❌ 评论 / 评分
- ❌ AI 室内设计生成
- ❌ 原生 App（用 PWA / 网页即可）
- ❌ 多供应商自助上载入口（第一阶段全部由 Jym 自己建）
- ❌ 社交功能
- ❌ **多产品同时 AR**（`<model-viewer>` 原生不支持，第二年再考虑 WebXR）
- ❌ 链接自动爬虫巡检（反爬风险高，改用用户反馈机制）

---

## 五、产品覆盖策略

**单一品类打透 → 再扩其他。**

500 个产品的初始分配：

| 品类 | 产品数 | 优先级 |
|------|--------|--------|
| 卫浴全品类（水龙头/花洒/马桶/浴室柜/浴缸/台盆/镜子/五金） | 150 | 最高（Jym 的主场） |
| 厨房（水槽/水龙头/抽油烟机/橱柜） | 80 | 高 |
| 灯具（主灯/吊灯/筒灯/台灯/落地灯） | 80 | 中 |
| 常用家具（边几/餐椅/书桌） | 80 | 中 |
| 点缀类（镜子/挂件/毛巾架/装饰） | 110 | 低 |

**第一阶段产品来源：全部来自 Wiltek 自有库存及 OEM 产品，零版权风险。** 扩展到其他品牌是第二阶段的事。

---

## 六、技术栈

| 功能 | 选择 | 原因 |
|------|------|------|
| 前端框架 | Next.js 14+ (App Router) + TypeScript + Tailwind | 标准、SEO 好、性能好 |
| 3D + AR 展示 | Google `<model-viewer>` | 一行代码支持 .glb + AR（iOS Quick Look + Android Scene Viewer），**不需要写原生 ARKit/ARCore** |
| 数据库 | Supabase (PostgreSQL) | 免费版够用 |
| 文件存储 | **Supabase Storage（Phase 1 唯一选择）** | 一站式、零跨账号；带宽成本若超阈值再迁 Cloudflare R2 |
| 鉴权（`/admin`） | **Next.js middleware + env 密码 + cookie session** | 无用户系统、无第三方依赖，够用 |
| 3D 生成 | Meshy API | 已验证单图可生成质量 OK 的模型 |
| **3D 压缩**（关键） | **`@gltf-transform/cli` + Draco（Phase 1）→ + KTX2 + meshopt（Phase 3）** | **必须压缩到 3-5MB，否则移动端崩溃；见 §9.2 分阶段策略** |
| 去背景 | rembg (Python 库) | 免费、本地跑 |
| AI 元数据填充 | Claude 3.5 Sonnet Vision 或 GPT-4o Vision | 看图自动填风格/色调/材质 |
| 部署 | Vercel | 免费版够用 |

---

## 七、数据库结构（Supabase）

### `products` 表

```sql
id                  uuid PRIMARY KEY
name                text              -- 产品名称
brand               text              -- 品牌
category            text              -- 一级类别：卫浴/厨房/灯具/家具/软饰
subcategory         text              -- 二级类别：水龙头/花洒/马桶...
style               text              -- 风格（枚举）
primary_color       text              -- 主色调（枚举）
material            text              -- 材质（枚举）
dimensions_mm       jsonb             -- {length, width, height}
weight_kg           numeric           -- 可选
price_myr           numeric           -- 基础价格
price_tier          text              -- economy/mid/premium
color_variants      jsonb             -- 颜色变体数组
installation        text              -- 安装方式（枚举）
applicable_space    text[]            -- 适用空间（可多选）
description         text              -- 产品描述（AI 生成草稿）
glb_url             text              -- 3D 模型 URL（已压缩）
glb_size_kb         integer           -- 文件大小
thumbnail_url       text              -- 缩略图 URL
purchase_url        text              -- 跳转购买链接
supplier            text              -- 供应商
status              text              -- draft / published / archived / link_broken
ai_filled_fields    text[]            -- AI 填充的字段列表
link_reported_broken_count  integer   -- 失效反馈次数
created_at          timestamp
updated_at          timestamp
```

### 颜色变体结构（`color_variants` 字段）

```json
[
  {
    "name": "Chrome",
    "hex": "#C0C0C0",
    "price_adjustment_myr": 0,
    "purchase_url_override": null
  },
  {
    "name": "Matte Black",
    "hex": "#1C1C1C",
    "price_adjustment_myr": 50,
    "purchase_url_override": "https://..."
  }
]
```

前端逻辑：点击颜色圆点 → `<model-viewer>` 实时换色 → 价格和购买链接动态更新。

**限制**：仅用于"纯换色"的变体（电镀色差异）。质感或功能差异作为独立产品。

### 字段枚举规范（**必须强制使用**）

**风格 (style)：**
`modern` / `minimalist` / `scandinavian` / `japanese` / `industrial` / `luxury` / `vintage` / `mediterranean` / `classic`

**主色调 (primary_color)：**
`white` / `black` / `grey` / `silver` / `gold` / `rose_gold` / `copper` / `brass` / `chrome` / `wood_light` / `wood_dark` / `beige` / `brown` / `blue` / `green`

**材质 (material)：**
`stainless_steel` / `brass` / `chrome_plated` / `ceramic` / `porcelain` / `glass` / `marble` / `granite` / `solid_wood` / `engineered_wood` / `fabric` / `leather` / `plastic` / `zinc_alloy`

**安装方式 (installation)：**
`wall_mounted` / `floor_standing` / `countertop` / `undermount` / `freestanding` / `built_in` / `ceiling_mounted` / `pendant`

**适用空间 (applicable_space)：**
`master_bathroom` / `guest_bathroom` / `kitchen` / `living_room` / `dining_room` / `master_bedroom` / `secondary_bedroom` / `study` / `balcony` / `entrance` / `laundry`

---

## 八、核心功能规格

### 8.1 前台：产品浏览（`/`）

- 网格列表展示所有 `published` 产品
- 每张卡片：缩略图 + 名称 + 价格 + 品牌
- 筛选面板：类别 / 风格（多选） / 色调（多选） / 价格区间 / 适用空间
- 搜索框（全文搜索 name + description + brand）
- 排序：最新 / 价格高低
- **懒加载**：一屏只加载可见产品的缩略图，3D 模型延迟加载

### 8.2 产品详情页（`/product/[id]`）

- 3D 模型展示（`<model-viewer>`，可旋转/缩放）
- **"在我家看看" 按钮** → 触发 AR 模式
- **颜色切换区**（如果有 color_variants）：
  - 颜色小圆点横排
  - 点击实时换色
  - 价格和购买链接同步更新
  - **Phase 1 简化方案（v1.2）**：用 CSS 滤镜 / `<model-viewer>` material override 改主色 hex 做"伪换色"。一个 .glb 对应多个变体，省存储、省流水线复杂度
  - **Phase 2 升级**：引入 glTF `KHR_materials_variants` 扩展或多 .glb 方案，支持真实纹理级换色
- 产品信息区：名称、品牌、价格、尺寸、材质、色调、风格、描述
- **"立即购买" 按钮** → 跳 `purchase_url`
- **"这个链接失效了？" 小按钮** → 一键报告（>=3 次自动改状态为 `link_broken`）
- **"相关搭配推荐"** 区块

### 8.3 AR 模式

- 使用 `<model-viewer>` 的 `ar` 属性
- iOS：自动触发 Quick Look
- Android：自动触发 Scene Viewer
- 无需额外代码
- **仅支持单产品 AR**

### 8.4 自动搭配推荐引擎

基于当前产品的 `style` + `primary_color`，查询：

```sql
SELECT * FROM products
WHERE style = current.style
  AND primary_color IN (current.primary_color, 'white', 'black')
  AND subcategory != current.subcategory
  AND status = 'published'
ORDER BY RANDOM()
LIMIT 6
```

在产品详情页底部显示："与此搭配的其他产品"。

### 8.5 管理后台（`/admin`）

**鉴权方案（v1.2 定稿）：Next.js middleware + env 密码 + httpOnly cookie session。**

- `middleware.ts` 拦截 `/admin/*` 路径
- 未登录跳 `/admin/login`
- 登录页 POST 密码 → 与 `APP_ADMIN_PASSWORD` 常量时间比较 → 成功则写 httpOnly + signed cookie（有效期 7 天）
- 无数据库用户表、无 OAuth、无 Supabase Auth
- Cookie 签名密钥：`APP_SESSION_SECRET`（随机 32 字节）

**8.5.1 产品列表视图**

- 表格：缩略图 / 名称 / 类别 / 状态 / AI 填充字段数 / 文件大小 / 创建时间 / 操作
- 过滤：状态、类别
- 批量操作：发布 / 归档 / 删除

**8.5.2 产品编辑页（核心 UI，Jym 每天使用）**

**必须极度高效。审核一个产品 ≤ 2 分钟。**

布局：
- **左侧**：3D 模型预览 + 原始照片缩略图
- **右侧**：所有字段的表单
  - AI 已填字段用**黄色背景**
  - 人工已确认字段用**绿色背景**
  - 未填字段用**红色边框**
- **颜色变体管理区**：可添加/删除颜色
- 底部：[保存草稿] [发布] [删除] 按钮

每个字段用**快速切换按钮**（不是下拉菜单）：
- 风格：9 个按钮横排
- 色调：15 个彩色圆点
- 材质：同理

**8.5.3 流水线监控页（`/admin/pipeline`）**

- 处理中的任务
- 今日处理数量
- 失败的任务
- **Meshy API 剩余额度 + 当日花费**
- **当日 API 调用次数 / 上限**

---

## 九、自动化流水线（**项目的核心护城河**）

### 9.1 输入

Jym 在本地电脑有一个"待处理"文件夹：

```
/to_process
  /20260419_tap_chrome_modern
    - photo1.jpg
    - photo2.jpg
    - photo3.jpg
    - photo4.jpg
```

文件夹名约定：`日期_品类_色调_风格`

### 9.2 处理流程

`pipeline.py` 监听 `/to_process`：

**Step 1：去背景** — rembg

**Step 2：选主图生成 3D** — Meshy API

**Step 3：3D 压缩（关键，不可省）—— v1.2 分阶段策略**

工具链：**`@gltf-transform/cli`**（替代 `gltf-pipeline`，一条命令同时处理 Draco + KTX2 + simplify + texture resize）。

**Phase 1（现在）—— 轻量压缩，先跑通流程：**
```bash
gltf-transform optimize input.glb output.glb \
  --compress draco \
  --texture-size 1024 \
  --simplify false
```
预期：30-80MB → **5-8MB**。`<model-viewer>` 开箱支持 Draco，零客户端配置。

**Phase 3（流水线阶段）—— 打到硬指标 3-5MB：**
```bash
gltf-transform optimize input.glb output.glb \
  --compress draco \
  --texture-compress ktx2 \
  --simplify true --ratio 0.75 --error 0.01
```
- KTX2：base color 用 `uastc`，normal/roughness 用 `etc1s`（normal 不能用 etc1s，会糊）
- meshopt simplify：仅在面数 > 100k 时触发
- `<model-viewer>` 需配 `ktx2-decoder-path`，iOS Safari 通过 WASM fallback

**强制校验关卡（两个都要）：**
1. 文件大小 ≤ 5MB（Phase 3）/ ≤ 8MB（Phase 1）
2. **SSIM 视觉保真度 ≥ 0.92**：headless Chrome 加载原始 .glb 和压缩后 .glb，各截一帧 512×512 对比。低于 0.92 告警并保留原文件
3. 失败则标记 `status='draft'` + 备注原因，不写 `published`

**Step 4：读取尺寸** — trimesh / pygltflib

**Step 5：生成缩略图** — 800x800 WebP

**Step 6：AI 元数据分析**

```
分析这张家居产品照片，严格按以下枚举值返回 JSON：

category: 卫浴 / 厨房 / 灯具 / 家具 / 软饰
subcategory: [根据 category 列表]
style: modern / minimalist / scandinavian / japanese / industrial / luxury / vintage / mediterranean / classic
primary_color: [完整列表]
material: [完整列表]
installation: [完整列表]
applicable_space: [数组]
description: 2-3 句中文描述，客观、不夸张

只返回 JSON，不确定字段返回 null。
```

**Step 7：本地备份** — `/backups/original/` + `/backups/compressed/`

**Step 8：上传 Supabase Storage**

**Step 9：写入数据库**（状态 = draft）

**Step 10：通知** — 终端输出结果

### 9.3 错误处理

- Meshy API 失败 → 重试 3 次
- 压缩失败 → 保留原始 .glb
- AI 分析失败 → 字段留空
- 上传失败 → 本地保留，下次重试

### 9.4 API 成本监控（**必加**）

```yaml
api_limits:
  meshy:
    daily_max_calls: 50
    daily_max_spend_myr: 75
  claude_vision:
    daily_max_calls: 100
    daily_max_spend_myr: 20

alerts:
  email: jym@wiltek.com
  threshold_percent: 80

emergency_stop_file: /tmp/decoright_emergency_stop
```

### 9.5 自动化调度

- `watchdog` 库监听 `/to_process`
- 队列：同时处理不超过 3 个产品

---

## 十、Jym 的实际工作流

**批量拍摄日（每周六）：**
1. Wiltek 仓库搭拍摄角落
2. 一次拍 20-30 个产品
3. 扔进 `/to_process`
4. 离开电脑

**审核日（周日早上）：**
1. 打开 `/admin`
2. 每个产品花 2 分钟审核
3. 填价格 + 购买链接 + 颜色变体
4. 发布

**单产品：拍照 10 分钟 + 审核 2 分钟**
**每周 2-3 小时 → 40-60 个产品 → 6-8 周达到 500**

---

## 十一、开发优先级

### Phase 1：骨架（第 1 周）
1. Next.js 项目初始化 + Tailwind + TypeScript + **brand config 文件**
2. Supabase 项目创建 + `products` 表 + Storage bucket
3. 首页（产品网格 + 筛选）
4. 产品详情页（`<model-viewer>` + AR + 颜色切换）
5. 部署 Vercel

### Phase 2：管理后台（第 2 周）
6. `/admin` 密码保护
7. 产品列表视图
8. **产品编辑页（核心 UI）**
9. 手动上传 5-10 个产品测试

### Phase 3：自动化流水线（第 3-4 周）
10. `pipeline.py`：rembg → Meshy → **gltf-pipeline 压缩** → trimesh → AI Vision → 备份 → Supabase
11. API 成本监控 + 紧急停止
12. `/admin/pipeline` 监控页

### Phase 4：优化（第 5-6 周）
13. 搭配推荐
14. 搜索优化
15. 性能优化
16. 链接反馈机制
17. SEO
18. 使用条款

### Phase 5（未来）
- 扩展其他品牌
- 链接巡检
- 多产品 AR
- 用户账号

---

## 十二、关键决策记录

- **为什么不做原生 App**：`<model-viewer>` 够用
- **为什么字段要枚举**：自由填写 = 数据库死亡
- **为什么 AI 填 + 人工审核**：准确率 70-95%，直接发布伤质量
- **为什么必须压缩 3D**：未压缩移动端崩溃
- **为什么要 API 上限**：防止 bug 烧钱
- **为什么单品类先**：深度 > 广度
- **为什么第一阶段只做 Wiltek**：零版权风险
- **为什么不做多产品 AR**：ROI 不合算
- **为什么链接不做爬虫**：反爬封 IP
- **为什么品牌名用变量**：未来改名成本为零

---

## 十三、成功指标

**6 个月只看两个数字：**
1. 库里已发布产品数量（目标：500）
2. 3D 模型质量的 Jym 满意率（目标：90%+）

---

## 十四、已验证的事实

- Meshy 6 单张照片生成质量满足商业使用
- Meshy API 单次成本 RM 0.45-1.35
- `<model-viewer>` 支持 iOS + Android 原生 AR
- gltf-pipeline + Draco 可压缩 50MB → 3-5MB

---

## 十五、给 Claude Code 的第一个任务

**用这段话开始：**

> 请先完整阅读 PROJECT_SPEC.md。
>
> 理解后，**先不要写代码**。
>
> 先告诉我：
> 1. 你理解的项目核心是什么？用一句话。
> 2. Phase 1 的五个子任务，你建议按什么顺序做？为什么？
> 3. 有哪些地方你觉得 spec 写得不够清楚？
> 4. 你打算如何处理 3D 压缩这个关键步骤？
>
> 确认对齐后，从 Phase 1 第 1 步开始：Next.js 项目初始化 + brand config 文件 + Supabase 连接。

---

*最后更新：2026-04-19（v1.2）*
*基于 Jym 与 Claude 的深度讨论整理，已吸收 Gemini 的风险提醒*

---

## 附：v1.2 变更记录（2026-04-19）

- **鉴权**定稿：Next.js middleware + env 密码 + httpOnly cookie session（§8.5）
- **存储**定稿：Phase 1 唯一用 Supabase Storage，R2 留未来迁移（§六）
- **颜色变体**Phase 1 简化为 CSS/material override 伪换色；真纹理级变体推至 Phase 2（§8.2）
- **环境变量前缀**细化：服务端 `APP_*`，客户端 `NEXT_PUBLIC_APP_*`（§三）
- **3D 压缩**工具换为 `@gltf-transform/cli`；分阶段策略：Phase 1 只 Draco + 1024 纹理（5-8MB），Phase 3 加 KTX2 + meshopt（3-5MB）；新增 SSIM ≥ 0.92 校验关卡（§9.2）
- **执行顺序**微调：Phase 1 子任务顺序 `1 → 2 → 5 → 4 → 3`——空壳先部署、详情页（技术风险最高）先于首页
