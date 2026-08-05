# 事故取证:产品未授权自动发布 — 2026-08-05

> **本文只取证,不修复。** 修复方案等定罪后由 Jym 裁定。下架由 Jym 在后台自行操作。
> 证据由只读脚本 `scripts/forensic-published-audit.ts`(纯 SELECT,零写入)+ 代码审计得出。

## 结论(定罪)

**未授权发布不是「闸松了」,是一条自动发布代码路径在无人点击时把草稿发成了 published。**

命案凶器:**`processDraftAsync` 在 AI 补全跑完、发布闸通过时,自动 `status='published'`**。
`src/app/admin/(dashboard)/products/actions.ts:3225-3228`:

```ts
// All green — flip to published.
await supabase
  .from("products")
  .update({ status: "published" })
  .eq("id", d.productId);
```

触发链(全自动,无一步需要人点击「发布」):

1. Jym **批量创建**产品(拖文件 + Save)—— 这是授权动作,创建的是**草稿**。
   `createProductFromUpload` 插入 `status: "draft"`(`actions.ts:2244`)。
2. 同一函数在 `after()` 尾包排队 AI 处理:
   `after(() => processDraftAsync({ productId, images: [] }))`(`actions.ts:2309`)。
   `after()` 是 Vercel 响应后的后台回调 —— **Jym 的请求早已返回,这一步他无从参与**。
3. `processDraftAsync`(`actions.ts:2922`)跑 GPT 抽取补字段,然后:高置信(无 `_low_confidence` 字段)
   + 发布闸 `checkPublishGates`(`actions.ts:3201`)通过 → **自动发布(`:3228`)**;否则只写 `missing_fields` 留草稿(`:3209`)。

Jym 从未点过发布(单个/批量都没有)——**发布是 `after()` 尾包里的这段代码干的**。

**这段自动发布是既有代码,不是本轮新写**:git 溯源到 commit `f085beb3`(2026-05-12,Wave 7 引入 auto-publish)。即 #34 / #41 / #43 都没有「新增」这条发布路径(见下逐一排除)。它这次开火的原因见第三节。

**同一自动发布还有第三个触发面(重要)**:`/api/admin/refill-draft` 路由 `route.ts:54` 也调用 `processDraftAsync`。即**「重传失败文件」这类补草稿动作也会重跑自动发布**。虽有 admin 鉴权(401),但它语义上是「补文件」不是「发布」—— 操作员不会预期它顺手把产品发上线。

## 一、数据取证

只读脚本结果(2026-08-05):

- 今日创建的产品:**32 个**;其中 **28 个已 published**,4 个仍 draft。
- 28 个 published 全部命中事故特征:**15 个 mirror(镜柜/镜子)、12 个 bathroom_vanity、1 个 vanity** —— 与 Jym 描述的「镜柜/镜子…约十几个」吻合。
- **每一个都是创建后 8–21 秒内被改成 published**(中位 10s):`min 8s · median 10s · max 21s · 28/28 ≤60s`。
  → 人不可能在 8–21 秒的间隔里连点 28 次发布。这个时序 = `after()` 后台尾包,不是人手。
- 28 个**全部** `ai_filled_fields` 有值(AI 抽取跑过,9–12 个字段)→ 证明走了 `processDraftAsync`。
- 28 个的 `missing_fields` 只有 `weight_kg` / `price_myr` —— **这两个都不是发布闸项**(闸项 = rooms/cutout/glb/fbx/retailer/scene);闸项(glb/fbx/thumb/scene)全齐 → 闸过 → 自动发布。
- 对照组:4 个仍 draft 的都是 **"Untitled product" + 无 AI**(`ai_filled_fields` 空)—— AI 尾包没在它们身上跑,所以没到发布那一步。**这恰好反证:发布与否取决于「AI 尾包是否跑 + 闸是否过」,不取决于任何人点击。**

### 两批时间线(均为批量创建 + 秒级连发)

| 批次 | 创建时间(UTC) | item_type | 数量 |
| --- | --- | --- | --- |
| A | 05:31:14 → 05:38:08 | mirror | 15 |
| B | 13:46:10 → 13:52:17 | bathroom_vanity / vanity | 13 |

(另有若干 07-27/07-09 创建、今日 03:07–04:08 被 `updated_at` 触及的老产品,是老 published 行被后台任务顺带更新 `updated_at`,非本次新发布,已排除。)

### 创建时即 published,还是创建后被改?

**创建后被改。** 创建路径插入的是 `status:"draft"`(`actions.ts:2244` bulk、`:2672` bulk 占位),`after()` 尾包在 ~10s 后才改成 published。数据侧佐证:同为今日创建但 **AI 尾包未跑** 的 4 个占位草稿仍是 draft —— 若创建默认就是 published,它们也该是 published。

## 二、代码路径审计(所有能写 `status='published'` 的点)

| # | 位置 | 写什么 | 触发 | 能否无人点击发布? |
| --- | --- | --- | --- | --- |
| **C(定罪)** | `actions.ts:3225-3228` `processDraftAsync` | `status='published'` | **`after()` 尾包自动跑**(`:2309` bulk create、`:2834` `bulkCreateProducts`),**外加 `/api/admin/refill-draft` route.ts:54**;高置信 + 闸过即发 | **能 ✅ 就是它** |
| A | `actions.ts:2244` `createProductFromUpload`(bulk create 插入) | `status:"draft"` | 创建 | 否(插的是 draft;溯源 `3b5f8c99` 2026-06-14 默认即 draft)|
| A' | `actions.ts:2672` `bulkCreateProducts`(占位插入) | `status:"draft"` | 创建 | 否 |
| B | `actions.ts:1352-1355` `bulkUpdateStatusAction` | `status: next`,仅 `.in("id", targetIds)`,`targetIds=passed`(闸过的)| 操作员点「批量发布」 | 否(需点击;`blockedIds` 只进 toast 深链,**不写 status**,未写反)|
| — | `actions.ts:1210-1213` `setProductStatusAction`(单产品 URL 可寻址)| `status: next` | 操作员/刻意 POST,过 draft→published 闸(`:1195-1207`)| 否(需刻意请求 + 过闸)|
| — | `actions.ts:1083` `updateProduct`(Save/Publish 表单)| `updates.status` 来自 intent(`:225-230`,`intent==='publish'` 才 published)| 操作员点「发布/保存」,过 `checkPublishGates`(`:1050`)| 否(需点击)|

**结论**:除 `processDraftAsync:3228` 外,其余写 published 的路径**都需要人点击/刻意请求**。今日 28 个产品是 `after()` 尾包在创建后自动发的,不经这些点击路径。

### 逐一排除四大嫌疑

- **嫌疑 A(创建默认值被 #34/#43 改成 published)——排除。** bulk 创建插入 `status:"draft"`(`:2244`)。#34/#43 改的是上传诊断/重试/连通性,未碰创建时的 status 默认值。
- **嫌疑 B(#41 把「跳过」写反成「发布」)——排除。** `bulkUpdateStatusAction` 只 `.update({status:next}).in("id", targetIds)`,`targetIds` = 通过闸的 `passed`(`:1341`);#41 新增的 `blockedIds` 仅用于回传 toast 的 `skipped=` 深链,**从不写 status**。且此路径需操作员点「批量发布」,本次未点。
- **嫌疑 C(AI 自动补全碰 status)——定罪。** 见上。
- **嫌疑 D(其它 `after()`/后台任务/route 写 status)——排除其余,唯 C 命中。** 全库 route/`after()` 扫描结论:
  - 场景封面 `dispatchSceneCover`(`:470`)、GLB 压缩 `dispatchGlbCompression`(`:1099/2304`)、FBX 打包 `dispatchFbxBundle`(`:1107/2307`)—— 均不写 `products.status`。
  - `/api/admin/compress-glb` 写 `compression_status`、`/api/admin/scene-cover` 写 `scene_cover_status`(`scene-cover.ts` 只**读** `status='published'`,不写)、`unify-thumbnail`/`fit-center`/`package-fbx`/`card-image` 只写 `thumbnail_url`/资源列 —— 都不是生命周期 `status`。
  - Meshy worker:自动发布**已被移除**(`MeshyStatusBanner.tsx:227` 注明 "worker no longer flips status='published'")。
  - Excel 导入(`import-actions.ts`):`status` 是**只读**列(不改状态)。`actions.ts:450/517` 的 `.upsert(...)` 是对 **`product_images`**,不是 products。
  - 唯一写 `status` 的 `after()`/route 是 `processDraftAsync`(`:2309` / `:2834` / `refill-draft route.ts:54`)。
- **嫌疑 6(migration 默认值 / DB 触发器)——排除。** `0001_init_products.sql:43` 默认 `status … DEFAULT 'draft'`;引用 `new.status='published'` 的触发器(`0011:84`、`0013:126`)是**校验器**(缺 rooms 就 RAISE 拦截),**不是 setter**;全库无任何 trigger/function/default 执行 `SET status='published'`。

## 三、为什么「今天」爆发(加重因素,非新增凶器)

`processDraftAsync` 的「闸过即自动发布」是 **既有设计**(注释自称 "AI auto-publish path",PB3-A era),不是这次新写的。让它这次对这批产品**开火**的,是最近的闸变化:

- **#41 场景闸从「只看封面」扩到「看全部图片」**:这批产品封面是白底图、实拍场景照在第 2/3 张。**#41 之前**它们过不了 `hasScene`(封面白底)→ 自动留草稿;**#41 之后**任一非封面图即算合格 → 闸过 → 自动发布尾包开火。28 个的 `scene_cover_status='skipped'`(没生成 AI 场景图)却仍过场景闸,正是「看全部图片」放行的指纹。
- bulk 创建链(#34/#43)让每个草稿都稳定挂上 glb+fbx+thumb → 其余闸项齐 → 全闸通过。

即:**#41 移走了最后一道把这批白底封面产品挡在草稿的闸,叠加既有的自动发布尾包,产品就在创建后 10 秒自行上架。**

## 四、最小复现

1. bulk create 一个产品:白底封面图 + 第 2 张实拍场景照 + glb + fbx + 供应商 + rooms(即所有发布闸项齐,`weight_kg/price_myr` 可缺,它们不是闸项)。
2. 点 Save(只创建,不点任何发布)。
3. 观察:创建后约 10 秒,该产品 `status` 自行由 `draft` → `published`,出现在前台 Latest Additions。
   - 落库信号:`ai_filled_fields` 有值、`missing_fields ⊆ {weight_kg, price_myr}`、`updated_at - created_at ≈ 8–21s`。
4. 反例:同样操作但**留一项闸项缺失**(如不挂供应商)→ 停在 draft(`missing_fields` 含 `publish_gate_retailer`)—— 证明闸过与否是唯一开关,人从未参与。

### 今日自动发布的 28 个产品 id(供 Jym 后台批量下架 / 核对)

> 下架由 Jym 自行操作;此处仅列取证名单。可用只读脚本随时重新生成:
> `npx tsx --env-file=.env.local scripts/forensic-published-audit.ts`

```
3a83aa81-e5f8-45ee-93ff-0c107a762072  White Bathroom Vanity
61c5c5d0-c9ec-4642-9e2f-f3aaac11a512  Bathroom Mirror Cabinet
5e88a713-46cd-49d8-84a9-b667f48a6e51  Bathroom Mirror Cabinet
fd251683-0495-4ed3-aca3-0c8dedeadfb4  Bathroom Mirror Box
9be59876-73b7-4ab2-8f28-9da78e789b1a  Black Aluminum LED Mirror
a39a76db-9a99-4005-acd4-8c61783fed62  Gold LED Light Mirror
45f483f6-c2eb-4456-9a9a-680d5bc99258  Brown Mirror Cabinet
60d2e9c3-975c-4444-827f-51bbc3c3a166  Grey Mirror Cabinet
8c2052db-426e-4c42-969f-177942eb7482  Black Mirror Cabinet
33d985ce-2bdd-42b2-8de8-baef57b210ec  White Mirror Cabinet
f69fef0a-1586-45e2-b2fa-7b577134ff6a  Black Mirror Cabinet
52b185d8-03df-47bb-bd57-3ba24fa3de85  Black Finish Mirror
1847dc26-1b80-4883-971c-06cdfdb4112d  Black Mirror Cabinet
bbc11d59-eb7b-4235-981c-78845372c0c6  Golden Yellow Mirror
28b5f1db-48a8-4fdc-8eed-0e29f18632d4  Rose Gold Finish Mirror
7072cdc2-da39-42a4-a5c4-7923f9d298df  White Mirror Cabinet
87bc682c-92f9-4076-a8ce-df38fa8b2e40  Black and Rose Gold Vanity
4a8b30f0-6e21-4eb2-8a51-9a7a5eaddd3f  Black Basin Cabinet
475f1edc-9d57-422a-a817-34d63447c17d  Brown Wall Mounted Vanity
0bfe5508-47e8-4de3-bf8e-7776d51b8359  White Bathroom Vanity
3da9fa84-7d21-4841-896a-ddfc9be41107  Black Bathroom Vanity
2dcb5798-6062-407f-99b1-f8e18a6f0fe8  Gunmetal Bathroom Vanity
165e4f41-ac17-4a10-bc82-9ee8c7005645  Black Bathroom Vanity
806a7eb9-e6aa-4df0-9cb6-2d2f0c0b16b6  Black Wall Hung Vanity
9772fa19-5f15-4697-ba3b-f3729ca836ed  Gunmetal Basin Cabinet
f00241c0-471e-475a-beb2-8d623493a27f  Gunmetal Bathroom Vanity
b1057f8f-f94e-4653-85dd-ea0c183e2660  Black Wall Hung Vanity
2eb713e6-b5a7-4a56-bddd-1486ec1bb8a4  Golden Yellow Bathroom Vanity
```

## 五、建议修法(只建议,不实施 —— 等 Jym 裁定)

按侵入度从小到大:

1. **摘掉自动发布(最直接)**:`processDraftAsync` 闸过后**不再** `status='published'`,改为把产品标成「就绪待发布」(如写 `missing_fields=[]` + 一个 `ready_to_publish` 标记),发布动作**只保留人点击**(单产品「发布」/ 批量发布)。=「AI 只补数据 + 判就绪,发布永远是人」。
2. **加发布来源审计(取证能力)**:给 status 变更记来源(`published_by`:`manual`/`bulk_action`/`auto_ai`,+ `published_at`)。本次事故正是因为没有来源字段,只能靠 `updated_at` 时序推断;补上后未来一眼可查。
3. **保留自动发布但加开关(折中)**:自动发布走一个 env / 后台开关,默认**关**;需要时 Jym 显式打开。当前的问题是它默认开且无人知情。

三者不互斥;(2) 无论选哪条都建议做(纯取证增益,不改发布语义)。

— 生成于 2026-08-05,取证脚本 `scripts/forensic-published-audit.ts`(只读)。
