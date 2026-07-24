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

## ② Item_type 摆位规则(1 条)

键 = `products.item_type` 的真实值。**无条目的类别不注入、不报错** —— 机制对所有类别就绪,规则内容按 Jym 的节奏逐类补,不预造。

### `toilet`

PLACEMENT (mandatory): the toilet's BACK — its cistern/tank and rear face — must sit FLUSH AGAINST A WALL, in full contact with it, because the soil/waste pipe exits the back into the wall. FORBIDDEN: do NOT place the toilet in the middle of the room; do NOT float it at an angle or diagonally away from the walls; do NOT leave any gap between its back and the wall; do NOT place it on a countertop, vanity or any raised surface. It stands on the floor with its back flush to the wall.

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

## ④ 东南亚背景道具层(item_type → 道具)

卫生间场景注入真实东南亚配件指引;若库内有对应 `referenceItemTypes` 的已上传产品,取其白底图喂给模型作风格参照(所引用产品 id 会被记录,作未来「场景中的其他产品」链接的数据基础)。库内无对应配件 → 降级纯文字,不报错。道具永远是配角,不抢镜、不遮挡主产品。

### `toilet`

- 指引:wall-visible Southeast-Asian bathroom accessories — a bidet spray hose on the wall beside the toilet, a wall-mounted toilet-paper holder, and a towel rail/rack
- 参照 item_types:`bathroom_equipments`

### `basin`

- 指引:wall-visible Southeast-Asian bathroom accessories — a towel rail/rack and a small wall shelf
- 参照 item_types:`bathroom_equipments`

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
