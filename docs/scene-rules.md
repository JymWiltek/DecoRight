# 场景摆位规则(自动导出 — 请勿手工编辑)

> 由 `config/mounting-scene-rules.ts` 经 `scripts/export-scene-rules.ts` 自动生成(`prebuild` 钩子,每次 `npm run build` 重跑)。**改规则请改 config 后重建 —— 手工改这份会被覆盖。**

场景 prompt 按固定顺序注入三段:**① mounting 安装约束 → ② item_type 摆位规则 → ③ 真实尺寸**。缺 mounting(无法判定安装方式)或缺尺寸(任一轴缺失)→ **拦截不生成**(禁止 AI 猜)。

## ① Mounting 安装规则(7 条)

键 = `products.attributes.mounting` 的真实值。给一个无产品使用的值加规则不会有任何效果,直到有产品用它。

### `wall_mounted`

INSTALLATION (mandatory): the product is fixed DIRECTLY to the wall and cantilevers off it. The space underneath the product must be COMPLETELY EMPTY — no countertop, no vanity, no cabinet, no pedestal, no legs and no surface of any kind supporting it from below. Do not place it on furniture.

### `counter_top`

INSTALLATION (mandatory): the product sits ON TOP of a countertop, its whole base resting on the counter surface, in full contact with it. It is not recessed into the counter and not mounted on the wall.

### `semi_recessed`

INSTALLATION (mandatory): the product is SEMI-RECESSED. Its lower half sinks DOWN INTO a cut-out in the countertop, so only the upper part and the rim rise above the counter surface, and the front portion protrudes out past the counter edge. FORBIDDEN: do NOT show the whole basin sitting on top of the counter; do NOT show the underside or the lower half of the basin; do NOT show the basin merely resting on the counter as a separate object stacked on it. The counter surface must visibly cut across the basin body.

### `floor_standing`

INSTALLATION (mandatory): the product stands DIRECTLY on the floor, its base in contact with the floor. It is not on a plinth, table or counter and it is not attached to the wall.

### `deck_mounted`

INSTALLATION (mandatory): the product is mounted THROUGH the deck — it rises out of a hole in the countertop or in the rim of the basin/sink, with its base flush against that surface. It is not wall-mounted and does not simply stand loose on the counter.

### `built_in`

INSTALLATION (mandatory): the product is recessed INTO the wall or into cabinetry so that only its front face is exposed, sitting flush with the surrounding surface. No part of the body protrudes into the room.

### `corner`

INSTALLATION (mandatory): the product is fitted into the internal angle where TWO WALLS MEET, touching both wall faces, with empty space below it. It must not be placed on a table, counter, shelf or any other furniture.

## ② Item_type 摆位规则(4 条)

键 = `products.item_type` 的真实值。**无条目的类别不注入、不报错** —— 机制对所有类别就绪,规则内容按 Jym 的节奏逐类补,不预造。

> ⚠️ `urinal` / `paper_holder` / `towel_shelf` 三条目前**不是**真实 item_type —— 库里这三类产品全是 `item_type='bathroom_equipments'`,靠**产品名关键词**(urinal / paper holder / towel)命中(见 `ACCESSORY_NAME_TO_RULE`)。待 taxonomy 拆分出独立 item_type(方案 B)后,按 item_type直接命中,名称分类器自动失效。

### `toilet`

PLACEMENT (mandatory): the toilet's BACK — its cistern/tank and rear face — must sit FLUSH AGAINST A WALL, in full contact with it, because the soil/waste pipe exits the back into the wall. FORBIDDEN: do NOT place the toilet in the middle of the room; do NOT float it at an angle or diagonally away from the walls; do NOT leave any gap between its back and the wall; do NOT place it on a countertop, vanity or any raised surface. It stands on the floor with its back flush to the wall.

### `urinal`

BATHROOM CONTEXT (mandatory): a real bathroom with tiled or waterproof walls. The urinal is fixed to the wall with its BACK flush against it; the bowl/rim sits about 600 mm above the floor, and the floor below it reads as a wet-area with a visible floor drain / drainage context. FORBIDDEN: do NOT render a domestic hallway, wood-floor or bedroom look; do NOT put it on open wooden shelving dressed with towels and plants; do NOT float it in the middle of the room; do NOT place it on a countertop.

### `paper_holder`

BATHROOM CONTEXT (mandatory): mounted on the wall within arm's reach of a toilet, about 700 mm above the floor, and by default LOADED with a paper roll. PREFERRED (not required): let the edge of the frame catch a corner of the toilet's side, so the bathroom context reads as real. FORBIDDEN: do NOT place it above a countertop; do NOT stage it on a cement counter with soap like a magazine styled-shoot; do NOT render it with no bathroom context around it.

### `towel_shelf`

BATHROOM CONTEXT (mandatory): mounted on the wall, about 1550 mm above the floor, and by default DRAPED with a folded towel. PREFERRED (not required): a wall near the shower area or beside the washbasin. FORBIDDEN: do NOT stand it on a countertop or on the floor; do NOT render a bedroom / hallway wooden-shelf look; do NOT pile it with clutter as if it were a general storage rack.

### `faucet`(无条件盆承接铁律 + 厨房/浴室分流)

faucet 不在上面的 map —— 盆承接是**无条件铁律**(不依赖 mounting 命中,mounting 为空也生效),并按**产品名**分流:命中 `kitchen` / `sink` / `pull-out` / `pull out` / `pullout` / `厨房` → kitchen(不锈钢厨房水槽 + 厨房语境);否则 → basin(陶瓷台盆 + 浴室语境)。承接盆是主产品的**物理承接**,库内无参照也必须画(不适用「无参照不画」道具铁律);有参照则喂图 + 记 `scene_reference_product_ids`。

#### `faucet · kitchen`

PLACEMENT (mandatory, IRON LAW — no exceptions): a faucet ALWAYS pours into a fixture that catches the water. There MUST be one DIRECTLY BELOW the spout, with the spout about 250 mm above its rim. When mounting is known this stacks with the mounting rule (wall-mounted = basin on a counter below the projecting spout; deck-mounted = faucet rising from the counter or the fixture's own rim). FORBIDDEN under ALL circumstances: do NOT place the faucet on a bare wall, an empty counter, the floor, or as a standalone decorative object; the area directly under the spout must NEVER be empty — a catching fixture is always present. CATCHING FIXTURE (mandatory): a STAINLESS-STEEL KITCHEN SINK (single or double bowl) set into a kitchen countertop. KITCHEN context — kitchen cabinetry/counter, not a bathroom. FORBIDDEN: do NOT use a ceramic bathroom basin or a bathroom setting for a kitchen faucet.

#### `faucet · basin`

PLACEMENT (mandatory, IRON LAW — no exceptions): a faucet ALWAYS pours into a fixture that catches the water. There MUST be one DIRECTLY BELOW the spout, with the spout about 250 mm above its rim. When mounting is known this stacks with the mounting rule (wall-mounted = basin on a counter below the projecting spout; deck-mounted = faucet rising from the counter or the fixture's own rim). FORBIDDEN under ALL circumstances: do NOT place the faucet on a bare wall, an empty counter, the floor, or as a standalone decorative object; the area directly under the spout must NEVER be empty — a catching fixture is always present. CATCHING FIXTURE (mandatory): a CERAMIC WASH BASIN on a vanity/counter. BATHROOM context. FORBIDDEN: do NOT use a stainless-steel kitchen sink or a kitchen setting for a basin faucet.

## ③ 背景色调池(材质 → 色调池,每次从池随机抽一个)

白瓷池刻意多样(暖木 / 冷灰水泥 / 深色地板 / 水磨石 / 浅彩墙),让一页白马桶不再是同一种暖米色。抽签按产品 id 稳定(同批产品散开),Regenerate 时换一个。

### `warm` — 白瓷 / 浅色产品(需最散,~9成马桶白瓷)(5 个)

- a warm Scandinavian bathroom with light oak, warm-white plaster walls and soft diffused daylight
- a cool grey bathroom with raw concrete and microcement walls, dark-grout tile and cool north light
- a bright white-tiled bathroom with a DARK stone floor and warm accent lighting
- a terrazzo bathroom with speckled terrazzo floor and walls and soft even daylight
- a calm bathroom with pale sage-green plaster walls, light travertine floor and gentle diffused daylight

### `cool` — 深色 / 金属产品(4 个)

- a cool modern bathroom with matte pale-grey stone and concrete, crisp cool-white daylight
- a contemporary bathroom with raw concrete and charcoal microcement walls, soft cool north light
- a moody dark bathroom with deep charcoal stone walls and low-key dramatic lighting
- a minimalist industrial bathroom with brushed grey concrete, dark-grout tile and neutral cool light

### `luxury` — 金 / 黄铜产品(4 个)

- a dark luxury bathroom with near-black marble walls and warm low-key lighting
- a warm boutique bathroom with deep taupe walls, walnut cabinetry and soft warm pooled light
- an elegant neutral bathroom with soft greige stone walls and even refined daylight
- a boutique-hotel bathroom in dark green-black marble with warm pooled light

### `neutral` — 彩色产品(3 个)

- a clean neutral gallery-like bathroom with soft light-grey walls and even shadowless daylight
- a minimal studio-like bathroom with off-white walls, pale grey floor and bright even light
- an airy neutral bathroom with white plaster walls, light grey stone and soft cool-neutral daylight

**客厅场景(sofa 等,每材质一个):**

- `warm`: a bright Scandinavian living room with warm white walls, light oak floor and a large window
- `cool`: a cool modern living room with grey concrete walls, matte flooring and soft cool daylight
- `luxury`: a dark luxury living room with charcoal walls, walnut and warm gold accent lighting
- `neutral`: a clean neutral living room with soft light-grey walls and even daylight

**厨房场景(range_hood,4 个):**

- a modern kitchen with matte pale-grey cabinetry, a cooktop directly below and soft cool daylight
- a contemporary kitchen with warm wood cabinets, a stone backsplash, a cooktop directly below and gentle warm light
- a sleek dark kitchen with charcoal cabinetry, a cooktop directly below and moody low-key lighting
- a minimalist kitchen with white cabinets, a concrete counter, a cooktop directly below and clean cool daylight

## ④ 背景道具层(item_type → 道具,铁律版)

**铁律(反转 #29):「See it, buy it」—— 场景里出现买不到的道具比空墙更糟。** 每类道具只有在库内存在该类配件产品**且有白底图**时才注入,并喂其白底图作风格参照;**库内没有该配件 → 该道具完全移除(不再有纯文字降级)**。每类道具还按**概率独立抽签**(按产品 id 稳定,Regenerate 换种子换组合),同类最多一次,**允许抽出零道具的干净空场景**。通用约束:所有物品必须有真实支撑面接触(置台面/挂墙面五金),禁止悬空漂浮。

### `toilet`

- `spray`(概率 60%,参照 `bathroom_equipments`):a bidet spray hose mounted on the wall beside the toilet
- `paper_holder`(概率 50%,参照 `bathroom_equipments`):a wall-mounted toilet-paper holder with a paper roll on it
- `towel`(概率 30%,参照 `bathroom_equipments`):a towel rail or rack on the wall holding a folded towel

### `basin`

- `towel`(概率 30%,参照 `bathroom_equipments`):a towel rail or rack on the wall holding a folded towel
- `shelf`(概率 30%,参照 `bathroom_equipments`):a small wall shelf beside the basin

### `bathroom_vanity`

- `mirror`(概率 90%,参照 `mirror`):a wall mirror mounted on the wall directly above the basin
- `towel_ring`(概率 30%,参照 `bathroom_equipments`):a towel ring on the wall with a hand towel

### `vanity`

- `mirror`(概率 90%,参照 `mirror`):a wall mirror mounted on the wall directly above the basin
- `towel_ring`(概率 30%,参照 `bathroom_equipments`):a towel ring on the wall with a hand towel

### 流程裁定:异形/非常规几何产品

安全扶手等异形/非常规几何产品的 AI 场景图**不强求** —— AI 常画歪。**实拍场景图优先**(#32 起实拍场景照与 AI 场景图同权过发布闸,人工上传一张真实场景照即可)。

## Subtype → mounting 兜底映射(7 条)

产品无显式 `attributes.mounting` 时,用 `subtype_slug` 推断 mounting。

| subtype_slug | ⇒ mounting |
| --- | --- |
| `counter_top` | `counter_top` |
| `wall_hung` | `wall_mounted` |
| `wall_mounted` | `wall_mounted` |
| `semi_recessed` | `semi_recessed` |
| `freestanding` | `floor_standing` |
| `free_standing` | `floor_standing` |
| `close_coupled` | `floor_standing` |
