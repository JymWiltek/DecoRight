# 下架名单 — 无场景图的已发布产品(2026-07-23)

**已执行**:以下 40 个产品的 status 由 published 改为 draft。

判据:`isSceneCoverUrl(thumbnail_url) === false`(thumbnail 不是 /scene- 图)。补上场景图后走正常发布流程回归。仅改 `status` 字段,无删除。

回滚:`update public.products set status='published' where id in (下列 id);`

## 按类目

### sofa — 13

- `ada3eb22-7cea-4edd-9e58-31a31a56830a` — Beige Curved Sofa
- `c8a57b2e-d4de-426c-87fe-9d0001c19cba` — Beige Three-seater Sofa
- `a31fc6bb-00be-462e-b147-ba989b7f3682` — Designer 2+3 Seater Sofa
- `d2a1ba3a-21e6-4b87-ada1-4850d1705d2e` — Grey L-Shape Sofa
- `32048c39-5b47-41aa-a59b-2ea4331e5ea5` — Grey L-shaped Recliner Sofa
- `c0962c43-4beb-4dd1-8520-cf60bfaf7960` — Grey Recliner Sofa
- `3af44715-2c59-452d-9003-e9798246e85b` — L-Shape Fabric Sofa
- `1ac74a93-cd63-43ce-aa03-cb6907264262` — L-Shape Sofa with Storage
- `9e7c4f50-1a9e-4966-8169-2099c945171e` — Light Blue Sofa Set
- `b71ae3aa-44a3-4732-871a-ce21d87733dd` — Light Grey L-shape Sofa
- `75939524-db28-4ba9-98dc-99f56e413df0` — White Fabric Sofa Set
- `d17dd648-f887-4142-8289-89d1983c99a0` — White L-shape Sofa
- `45c8244c-3731-441f-b820-b3a653589bee` — White Sofa Set

### toilet — 11

- `8203bbbc-d8b4-4e77-ab91-efb37849f50a` — Close Coupled Toilet
- `00da3001-fd1e-48cf-b64c-d554d7646768` — Close Coupled Toilet
- `088c29d4-b994-4eec-af68-f7fba0c8cfe0` — One Piece Washdown Toilet
- `cfbdd4f4-1189-4c47-804b-c84daa6003f7` — One Piece Washdown Toilet
- `d0b1d3be-bfcb-4a60-86d5-4645203ad032` — One Piece Washdown Toilet
- `9471375a-9e6e-45ba-b1be-099202dcfe3e` — One Piece Washdown Toilet
- `894d3263-b663-4e06-a718-4bfca19ee491` — Pulse Wall Hung Closet
- `901046e8-b2a4-40ff-91ae-29167e5ddc8b` — Washdown Two-piece Closet
- `135682e1-2247-471b-abe5-9b1bd7a1f752` — White Close Coupled Toilet
- `d8ee7c1e-4ca0-4644-a786-5a727265da40` — White Close Coupled Toilet
- `6a145adc-a124-4579-b088-eba1beaac147` — White One-piece Toilet

### dining_table — 5

- `a7937fb9-cb39-4aab-8e4e-d3fdbec45ffc` — Grey Dining Table Set
- `6c5df445-fca3-4736-a8b4-8e5ae2e1b043` — Marble Dining Table Set
- `bcf15efc-a70b-4ead-b9e9-d99d84da9c06` — Round Marble Dining Table
- `ef1486b1-e419-41bb-95f5-0c5d233d0e02` — White Stone Dining Table
- `dc170d9b-6b70-41c1-9fa3-845bf07164de` — Wooden Dining Set

### bathroom_vanity — 3

- `604ba713-6c52-49e0-a2d6-62cea12d4599` — Bathroom Vanity Set
- `08d7bb50-0de1-41ac-8ed3-bee518119673` — Black Bathroom Vanity
- `b4baabff-6e39-455c-909e-fdb492ec636c` — Wall Hung Vanity Unit

### bathtub — 3

- `051071ec-a451-4a2c-9728-94e23ed90a02` — Correra Massage Bathtub
- `d5850947-177c-4f6e-b997-7b92bf9c999c` — Periera Massage Bathtub
- `af6e0273-d160-4ac6-9390-46209c4972e4` — Pravia Massage Bathtub

### vanity — 2

- `a2a2ab48-fed5-453a-bfb1-32ba49aee032` — LED Mirror Dressing Table
- `ba8dc807-ee0b-4007-af95-10f901100f15` — Oval Mirror LED Dressing Table

### bathroom_equipments — 1

- `ee412e38-c4c6-4bbf-819c-c344f9cf74f9` — Wall Hung Urinal

### bed_frame — 1

- `2bad9d2a-e7ed-4907-ae0c-074e7ba782ad` — Grey Bed Frame

### faucet — 1

- `83392465-f3e2-44e9-84f6-feafacdcce1a` — Black Faucet
