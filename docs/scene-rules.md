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
