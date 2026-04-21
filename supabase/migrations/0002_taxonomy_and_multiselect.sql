-- ──────────────────────────────────────────────────────────────
-- DecoRight — Phase 2.5 — taxonomy tables + multi-select refactor
-- Paste this entire file into Supabase SQL Editor and click "Run".
-- Idempotent: safe to re-run.
--
-- What it does:
--   1. Creates 5 taxonomy tables (item_types, rooms, styles, materials, colors)
--      that admin can add to via /admin/taxonomy — no SQL needed for new items.
--   2. Seeds them with the agreed Malaysian-home default list.
--   3. Refactors products:
--        - drops category / subcategory / style / primary_color / material /
--          installation / applicable_space / color_variants
--        - adds item_type (text, single), rooms (text[]), styles (text[]),
--          colors (text[]), materials (text[])
--   4. Migrates the 3 existing seed rows to the new shape.
-- ──────────────────────────────────────────────────────────────

-- ========== 1. TAXONOMY TABLES ==========

create table if not exists public.item_types (
  slug text primary key,
  label_zh text not null,
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);

create table if not exists public.rooms (
  slug text primary key,
  label_zh text not null,
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);

create table if not exists public.styles (
  slug text primary key,
  label_zh text not null,
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);

create table if not exists public.materials (
  slug text primary key,
  label_zh text not null,
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);

create table if not exists public.colors (
  slug text primary key,
  label_zh text not null,
  hex text not null check (hex ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);

alter table public.item_types enable row level security;
alter table public.rooms enable row level security;
alter table public.styles enable row level security;
alter table public.materials enable row level security;
alter table public.colors enable row level security;

drop policy if exists "public read item_types" on public.item_types;
create policy "public read item_types" on public.item_types
  for select to anon, authenticated using (true);

drop policy if exists "public read rooms" on public.rooms;
create policy "public read rooms" on public.rooms
  for select to anon, authenticated using (true);

drop policy if exists "public read styles" on public.styles;
create policy "public read styles" on public.styles
  for select to anon, authenticated using (true);

drop policy if exists "public read materials" on public.materials;
create policy "public read materials" on public.materials
  for select to anon, authenticated using (true);

drop policy if exists "public read colors" on public.colors;
create policy "public read colors" on public.colors
  for select to anon, authenticated using (true);

-- ========== 2. SEED TAXONOMY ==========

insert into public.item_types (slug, label_zh, sort_order) values
  ('sofa','沙发',10),
  ('coffee_table','茶几',20),
  ('tv_cabinet','电视柜',30),
  ('rug','地毯',40),
  ('curtain','窗帘',50),
  ('ceiling_light','主灯',60),
  ('pendant_light','吊灯',65),
  ('floor_lamp','落地灯',70),
  ('table_lamp','台灯',75),
  ('wall_art','装饰画',80),
  ('dining_table','餐桌',90),
  ('dining_chair','餐椅',100),
  ('sideboard','餐边柜',110),
  ('kitchen_cabinet','橱柜',120),
  ('sink','水槽',130),
  ('faucet','水龙头',140),
  ('range_hood','抽油烟机',150),
  ('cooktop','炉具',160),
  ('oven','烤箱',170),
  ('fridge','冰箱',180),
  ('bed_frame','床架',190),
  ('mattress','床垫',200),
  ('nightstand','床头柜',210),
  ('wardrobe','衣柜',220),
  ('vanity','梳妆台',230),
  ('toilet','马桶',240),
  ('bathroom_vanity','浴室柜',250),
  ('bathtub','浴缸',260),
  ('shower','淋浴房',270),
  ('showerhead','花洒',280),
  ('mirror','镜子',290),
  ('shoe_cabinet','鞋柜',300),
  ('flooring','瓷砖/地板',310),
  ('paint','墙漆',320),
  ('door','门',330),
  ('switch_panel','开关插座面板',340)
on conflict (slug) do nothing;

insert into public.rooms (slug, label_zh, sort_order) values
  ('living_room','客厅',10),
  ('dining_room','餐厅',20),
  ('kitchen','厨房',30),
  ('master_bedroom','主卧',40),
  ('secondary_bedroom','次卧',50),
  ('bathroom','浴室',60),
  ('entrance','玄关/过道',70),
  ('balcony','阳台',80),
  ('whole_house','全屋',90)
on conflict (slug) do nothing;

insert into public.styles (slug, label_zh, sort_order) values
  ('modern','现代',10),
  ('minimalist','极简',20),
  ('scandinavian','北欧',30),
  ('japanese','日式',40),
  ('industrial','工业',50),
  ('luxury','轻奢',60),
  ('vintage','复古',70),
  ('mediterranean','地中海',80),
  ('classic','古典',90)
on conflict (slug) do nothing;

insert into public.materials (slug, label_zh, sort_order) values
  ('stainless_steel','不锈钢',10),
  ('brass','黄铜',20),
  ('chrome_plated','镀铬',30),
  ('ceramic','陶瓷',40),
  ('porcelain','瓷',50),
  ('glass','玻璃',60),
  ('marble','大理石',70),
  ('granite','花岗岩',80),
  ('solid_wood','实木',90),
  ('engineered_wood','复合木',100),
  ('fabric','布艺',110),
  ('leather','皮革',120),
  ('plastic','塑料',130),
  ('zinc_alloy','锌合金',140)
on conflict (slug) do nothing;

insert into public.colors (slug, label_zh, hex, sort_order) values
  ('white','白色','#FFFFFF',10),
  ('black','黑色','#1C1C1C',20),
  ('grey','灰色','#8E8E93',30),
  ('silver','银色','#C0C0C0',40),
  ('gold','金色','#D4AF37',50),
  ('rose_gold','玫瑰金','#B76E79',60),
  ('copper','铜色','#B87333',70),
  ('brass','黄铜','#B5A642',80),
  ('chrome','铬色','#C4C4C4',90),
  ('wood_light','浅木色','#D8B894',100),
  ('wood_dark','深木色','#5D4037',110),
  ('beige','米色','#E8DCC4',120),
  ('brown','棕色','#6F4E37',130),
  ('blue','蓝色','#3B5998',140),
  ('green','绿色','#5A7A52',150)
on conflict (slug) do nothing;

-- ========== 3. PRODUCTS: NEW COLUMNS ==========

alter table public.products
  add column if not exists item_type text,
  add column if not exists rooms     text[] not null default '{}',
  add column if not exists styles    text[] not null default '{}',
  add column if not exists colors    text[] not null default '{}',
  add column if not exists materials text[] not null default '{}';

-- ========== 4. MIGRATE EXISTING 3 SEED ROWS ==========

update public.products set
  item_type = coalesce(item_type,
    case
      when name ilike '%吊灯%'   then 'pendant_light'
      when name ilike '%餐椅%'   then 'dining_chair'
      when name ilike '%水龙头%' then 'faucet'
    end);

-- map applicable_space[] (old slugs) → rooms[] (new slugs)
update public.products
  set rooms = (
    select coalesce(array_agg(distinct new_slug), '{}'::text[])
    from unnest(coalesce(applicable_space, '{}'::text[])) as old(slug)
    cross join lateral (
      select case old.slug
        when 'master_bathroom'   then 'bathroom'
        when 'guest_bathroom'    then 'bathroom'
        when 'kitchen'           then 'kitchen'
        when 'living_room'       then 'living_room'
        when 'dining_room'       then 'dining_room'
        when 'master_bedroom'    then 'master_bedroom'
        when 'secondary_bedroom' then 'secondary_bedroom'
        when 'study'             then 'whole_house'
        when 'balcony'           then 'balcony'
        when 'entrance'          then 'entrance'
        when 'laundry'           then 'whole_house'
        else null
      end as new_slug
    ) m
    where new_slug is not null
  )
where cardinality(rooms) = 0;

-- single-value → array carry-overs (only if new cols are still empty)
update public.products set styles    = array[style]::text[]         where style         is not null and cardinality(styles)    = 0;
update public.products set colors    = array[primary_color]::text[] where primary_color is not null and cardinality(colors)    = 0;
update public.products set materials = array[material]::text[]      where material      is not null and cardinality(materials) = 0;

-- ========== 5. DROP OLD COLUMNS + CHECKS ==========

alter table public.products drop constraint if exists products_category_chk;
alter table public.products drop constraint if exists products_style_chk;
alter table public.products drop constraint if exists products_primary_color_chk;
alter table public.products drop constraint if exists products_material_chk;
alter table public.products drop constraint if exists products_installation_chk;
alter table public.products drop constraint if exists products_applicable_space_chk;
alter table public.products drop constraint if exists products_price_tier_chk;

drop index if exists public.products_category_idx;
drop index if exists public.products_style_idx;
drop index if exists public.products_primary_color_idx;
drop index if exists public.products_applicable_space_gin;

alter table public.products drop column if exists category;
alter table public.products drop column if exists subcategory;
alter table public.products drop column if exists style;
alter table public.products drop column if exists primary_color;
alter table public.products drop column if exists material;
alter table public.products drop column if exists installation;
alter table public.products drop column if exists applicable_space;
alter table public.products drop column if exists color_variants;

-- ========== 6. NEW INDEXES ==========

create index if not exists products_item_type_idx on public.products (item_type);
create index if not exists products_rooms_gin     on public.products using gin (rooms);
create index if not exists products_styles_gin    on public.products using gin (styles);
create index if not exists products_colors_gin    on public.products using gin (colors);
create index if not exists products_materials_gin on public.products using gin (materials);
