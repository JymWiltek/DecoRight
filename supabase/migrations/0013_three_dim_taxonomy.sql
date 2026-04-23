-- 0013_three_dim_taxonomy.sql
--
-- Three-dimension taxonomy redo. Rooms, Item Types, and Subtypes are
-- now orthogonal dimensions instead of a pipeline.
--
-- Wrong model (before): every item_type belonged to exactly one room
-- (item_types.room_slug NOT NULL), and every subtype inherited a room
-- (item_subtypes.room_slug NOT NULL). That forced absurdities like
-- "kitchen_faucet" and "basin_faucet" as subtypes of Faucet — room
-- dressing masquerading as shape/style. It also made a single
-- Faucet product unable to live in both Kitchen and Bathroom at once.
--
-- Correct model (after):
--   - item_types.room_slug: GONE
--   - item_type_rooms: M2M table (faucet → [kitchen, bathroom, balcony])
--   - item_subtypes.room_slug: GONE (subtype = shape/style only)
--   - products.room_slugs text[]: the product chooses its rooms directly
--
-- Trigger changes: products_check_room_derivable + product_room_slug()
-- are dropped (they existed only to derive a room from the taxonomy
-- pipeline). Replaced with a simpler check: published products must
-- have at least one room_slug.
--
-- Data migration:
--   - products.room_slugs backfilled from the old item_types.room_slug
--   - Wrong subtypes (room-flavoured) deleted; any product pointing at
--     one of them has subtype_slug NULLed first so the FK is happy
--   - Correct shape/style subtypes seeded per Notion 架构决策 spec
--   - `sofa` item_type added (was missing) with its subtypes
--   - Balcony room gets tri-lingual labels (was English-only)

begin;

-- ---------------------------------------------------------------
-- 1. M2M join table: item_type × room
-- ---------------------------------------------------------------
create table item_type_rooms (
  item_type_slug text not null references item_types(slug) on delete cascade on update cascade,
  room_slug      text not null references rooms(slug)      on delete cascade on update cascade,
  sort_order     int  not null default 100,
  created_at     timestamptz not null default now(),
  primary key (item_type_slug, room_slug)
);
create index idx_item_type_rooms_room on item_type_rooms(room_slug);
create index idx_item_type_rooms_item on item_type_rooms(item_type_slug);

-- Seed from existing single-room column so no item_type loses its room
insert into item_type_rooms (item_type_slug, room_slug)
select slug, room_slug from item_types where room_slug is not null;

-- Per 架构决策: faucet spans kitchen / bathroom / balcony
insert into item_type_rooms (item_type_slug, room_slug) values
  ('faucet', 'kitchen'),
  ('faucet', 'bathroom'),
  ('faucet', 'balcony')
on conflict do nothing;

-- Mirror is cross-room (not just "decor")
insert into item_type_rooms (item_type_slug, room_slug) values
  ('mirror', 'bedroom'),
  ('mirror', 'bathroom'),
  ('mirror', 'entrance'),
  ('mirror', 'decor')
on conflict do nothing;

-- Rug / wall_art / lighting are also cross-room in reality
insert into item_type_rooms (item_type_slug, room_slug) values
  ('rug',           'living_room'),
  ('rug',           'bedroom'),
  ('rug',           'decor'),
  ('wall_art',      'living_room'),
  ('wall_art',      'bedroom'),
  ('wall_art',      'decor'),
  ('ceiling_light', 'living_room'),
  ('ceiling_light', 'dining_room'),
  ('ceiling_light', 'bedroom'),
  ('ceiling_light', 'lighting'),
  ('pendant_light', 'living_room'),
  ('pendant_light', 'dining_room'),
  ('pendant_light', 'bedroom'),
  ('pendant_light', 'lighting'),
  ('floor_lamp',    'living_room'),
  ('floor_lamp',    'bedroom'),
  ('floor_lamp',    'lighting'),
  ('table_lamp',    'living_room'),
  ('table_lamp',    'bedroom'),
  ('table_lamp',    'lighting')
on conflict do nothing;

-- ---------------------------------------------------------------
-- 2. Tri-lingual labels for Balcony (was English-only)
-- ---------------------------------------------------------------
update rooms
   set label_zh = coalesce(label_zh, '阳台'),
       label_ms = coalesce(label_ms, 'Balkoni')
 where slug = 'balcony';

-- ---------------------------------------------------------------
-- 3. products.room_slugs — the new source of truth for room
-- ---------------------------------------------------------------
alter table products add column room_slugs text[] not null default '{}';
create index idx_products_room_slugs on products using gin (room_slugs);

-- Backfill from the old item_types.room_slug so no published product
-- loses its room when the trigger is replaced below.
update products p
   set room_slugs = array[it.room_slug]
  from item_types it
 where p.item_type = it.slug
   and it.room_slug is not null
   and (p.room_slugs is null or p.room_slugs = '{}'::text[]);

-- ---------------------------------------------------------------
-- 4. Drop the "derived room" trigger and helper
-- ---------------------------------------------------------------
drop trigger if exists products_room_derivable on products;
drop function if exists products_check_room_derivable();
drop function if exists product_room_slug(products);

-- Replacement: published products must have at least one room.
create or replace function products_check_rooms_required()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'published'
     and coalesce(array_length(new.room_slugs, 1), 0) = 0 then
    raise exception
      'Published product % must have at least one room_slug', new.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger products_rooms_required
before insert or update of status, room_slugs on products
for each row execute function products_check_rooms_required();

-- ---------------------------------------------------------------
-- 5. Purge wrong subtypes (room-flavoured) before dropping column
-- ---------------------------------------------------------------
-- Null out product FKs that point at soon-to-be-deleted subtypes
update products
   set subtype_slug = null
 where subtype_slug in (
   'kitchen_faucet','basin_faucet','wall_faucet','shower_faucet',
   'bathroom_mirror','full_body_mirror','decor_mirror',
   'living_pendant','dining_pendant','bedroom_pendant'
 );

delete from item_subtypes
 where slug in (
   'kitchen_faucet','basin_faucet','wall_faucet','shower_faucet',
   'bathroom_mirror','full_body_mirror','decor_mirror',
   'living_pendant','dining_pendant','bedroom_pendant'
 );

-- Dining-table subtypes (round/square/rectangular) are shape-correct,
-- keep them but clear their stale room_slug via DROP COLUMN below.

-- ---------------------------------------------------------------
-- 6. Drop room_slug from taxonomy tables
-- ---------------------------------------------------------------
alter table item_subtypes drop column room_slug;
alter table item_types    drop column room_slug;

-- ---------------------------------------------------------------
-- 7. Add missing sofa item_type + its rooms
-- ---------------------------------------------------------------
insert into item_types (slug, label_en, label_zh, label_ms, sort_order)
values ('sofa', 'Sofa', '沙发', 'Sofa', 15)
on conflict (slug) do nothing;

insert into item_type_rooms (item_type_slug, room_slug) values
  ('sofa', 'living_room'),
  ('sofa', 'bedroom')
on conflict do nothing;

-- ---------------------------------------------------------------
-- 8. Seed correct shape/style subtypes
-- ---------------------------------------------------------------
-- Faucet: Pull-out, Sensor, Traditional, Wall-mounted
insert into item_subtypes (item_type_slug, slug, label_en, label_zh, label_ms, sort_order) values
  ('faucet', 'pull_out',     'Pull-out',     '抽拉式', 'Tarik Keluar',          10),
  ('faucet', 'sensor',       'Sensor',       '感应式', 'Sensor',                20),
  ('faucet', 'traditional',  'Traditional',  '传统式', 'Tradisional',           30),
  ('faucet', 'wall_mounted', 'Wall-mounted', '壁挂式', 'Dipasang di Dinding',   40);

-- Sofa: L-shape, Round, Square, 1/2/3-seater
insert into item_subtypes (item_type_slug, slug, label_en, label_zh, label_ms, sort_order) values
  ('sofa', 'l_shape',      'L-shape',   'L 形',  'Bentuk L',           10),
  ('sofa', 'round',        'Round',     '圆形',  'Bulat',              20),
  ('sofa', 'square',       'Square',    '方形',  'Persegi',            30),
  ('sofa', 'one_seater',   '1-seater',  '单人位', '1 Tempat Duduk',    40),
  ('sofa', 'two_seater',   '2-seater',  '双人位', '2 Tempat Duduk',    50),
  ('sofa', 'three_seater', '3-seater',  '三人位', '3 Tempat Duduk',    60);

-- Bathtub: Freestanding, Built-in, Whirlpool
insert into item_subtypes (item_type_slug, slug, label_en, label_zh, label_ms, sort_order) values
  ('bathtub', 'freestanding', 'Freestanding', '独立式',     'Berdiri Sendiri', 10),
  ('bathtub', 'built_in',     'Built-in',     '嵌入式',     'Terbina Dalam',   20),
  ('bathtub', 'whirlpool',    'Whirlpool',    '按摩浴缸',   'Whirlpool',       30);

-- Mirror: Full-body, Decor, Lighted
insert into item_subtypes (item_type_slug, slug, label_en, label_zh, label_ms, sort_order) values
  ('mirror', 'full_body', 'Full-body', '全身镜', 'Cermin Badan Penuh', 10),
  ('mirror', 'decor',     'Decor',     '装饰镜', 'Cermin Hiasan',      20),
  ('mirror', 'lighted',   'Lighted',   '带灯镜', 'Cermin Bercahaya',   30);

commit;
