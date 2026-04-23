-- ─────────────────────────────────────────────────────────────────
-- 0012 — Seed item_subtypes and tri-lingual region labels
--
-- 0011 created the item_subtypes table and the regions table, but
-- the storefront shipped with NEITHER seeded — empty subtype picker
-- and zh/ms-null region labels. This migration fills both:
--
--   • mirror item_type (was missing — three of its subtypes need it)
--   • 13 subtypes covering faucet / mirror / pendant_light / dining_table
--   • zh + ms labels for all 16 Malaysian states / federal territories
--
-- All inserts/updates are idempotent (ON CONFLICT … DO NOTHING /
-- explicit UPDATE per slug) so re-running is safe.
-- ─────────────────────────────────────────────────────────────────

-- 1) Ensure 'mirror' item_type exists; default room=decor (subtypes
--    override per-room: bathroom_mirror→bathroom, full_body→bedroom).
insert into public.item_types(slug, room_slug, label_en, label_zh, label_ms, sort_order)
values ('mirror', 'decor', 'Mirror', '镜子', 'Cermin', 90)
on conflict (slug) do nothing;

-- 2) Subtypes — faucet (4), mirror (3), pendant_light (3), dining_table (3).
insert into public.item_subtypes(slug, item_type_slug, room_slug, label_en, label_zh, label_ms, sort_order) values
  ('kitchen_faucet','faucet','kitchen','Kitchen Faucet','厨房水龙头','Paip Dapur',10),
  ('basin_faucet','faucet','bathroom','Basin Faucet','面盆水龙头','Paip Sinki',11),
  ('wall_faucet','faucet','bathroom','Wall Faucet','壁挂水龙头','Paip Dinding',12),
  ('shower_faucet','faucet','bathroom','Shower Faucet','花洒水龙头','Paip Mandian',13),
  ('bathroom_mirror','mirror','bathroom','Bathroom Mirror','浴室镜','Cermin Bilik Mandi',10),
  ('full_body_mirror','mirror','bedroom','Full Body Mirror','全身镜','Cermin Penuh',11),
  ('decor_mirror','mirror','decor','Decor Mirror','装饰镜','Cermin Hiasan',12),
  ('living_pendant','pendant_light','living_room','Living Room Pendant','客厅吊灯','Lampu Gantung Ruang Tamu',10),
  ('dining_pendant','pendant_light','dining_room','Dining Room Pendant','饭厅吊灯','Lampu Gantung Ruang Makan',11),
  ('bedroom_pendant','pendant_light','bedroom','Bedroom Pendant','卧室吊灯','Lampu Gantung Bilik Tidur',12),
  ('round_dining_table','dining_table','dining_room','Round Dining Table','圆形餐桌','Meja Makan Bulat',10),
  ('square_dining_table','dining_table','dining_room','Square Dining Table','方形餐桌','Meja Makan Persegi',11),
  ('rectangular_dining_table','dining_table','dining_room','Rectangular Dining Table','长形餐桌','Meja Makan Empat Segi',12)
on conflict (item_type_slug, slug) do nothing;

-- 3) Tri-lingual labels for all 16 regions (zh + ms were null after
--    0011's English-only seed).
update public.regions set label_zh='槟城',     label_ms='Pulau Pinang'    where slug='penang';
update public.regions set label_zh='吉打',     label_ms='Kedah'           where slug='kedah';
update public.regions set label_zh='玻璃市',   label_ms='Perlis'          where slug='perlis';
update public.regions set label_zh='霹雳',     label_ms='Perak'           where slug='perak';
update public.regions set label_zh='雪兰莪',   label_ms='Selangor'        where slug='selangor';
update public.regions set label_zh='吉隆坡',   label_ms='Kuala Lumpur'    where slug='kuala_lumpur';
update public.regions set label_zh='布城',     label_ms='Putrajaya'       where slug='putrajaya';
update public.regions set label_zh='森美兰',   label_ms='Negeri Sembilan' where slug='negeri_sembilan';
update public.regions set label_zh='马六甲',   label_ms='Melaka'          where slug='melaka';
update public.regions set label_zh='柔佛',     label_ms='Johor'           where slug='johor';
update public.regions set label_zh='彭亨',     label_ms='Pahang'          where slug='pahang';
update public.regions set label_zh='登嘉楼',   label_ms='Terengganu'      where slug='terengganu';
update public.regions set label_zh='吉兰丹',   label_ms='Kelantan'        where slug='kelantan';
update public.regions set label_zh='沙巴',     label_ms='Sabah'           where slug='sabah';
update public.regions set label_zh='砂拉越',   label_ms='Sarawak'         where slug='sarawak';
update public.regions set label_zh='纳闽',     label_ms='Labuan'          where slug='labuan';
