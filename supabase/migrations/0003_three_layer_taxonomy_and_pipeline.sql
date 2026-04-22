-- Phase 3 overhaul
--
-- 1. Restructure taxonomy from flat to 3-layer:
--    rooms (L1) → item_types (L2) → item_subtypes (L3, optional)
-- 2. Attach per-item attribute_schema (jsonb) so each item type can declare
--    its own custom fields (e.g. faucet's control_type, flow_rate).
-- 3. Introduce image pipeline: product_images table (1:N with products)
--    carrying raw → cutout → approval lifecycle.
-- 4. Reserve Meshy 3D-generation columns on products for stage B.
-- 5. Shared quota + guardrails: app_config (KV) + api_usage (rembg + meshy).
--
-- Safe: no user data is lost. products.rooms[] is dropped (redundant —
-- room is now derived from item_type.room_slug), but seed data had no info
-- in rooms[] that isn't recoverable via item_type → room parent.

set search_path = public;

-- =========================================================================
-- STEP 1. Drop redundant products.rooms[] (replaced by item_type → room)
-- =========================================================================
drop index if exists products_rooms_gin;
alter table public.products drop column if exists rooms;

-- =========================================================================
-- STEP 2. Reshape rooms contents
--   Old: 客厅·餐厅·厨房·主卧·次卧·浴室·玄关/过道·阳台·全屋  (9)
--   New: 客厅·饭厅·厨房·卧室·浴室·玄关·装饰·灯·墙地·窗帘·门 (11)
-- =========================================================================
delete from public.rooms
 where slug in ('master_bedroom','secondary_bedroom','balcony','whole_house');

-- Clean up test-only item_type added during QA (not part of the seeded set).
delete from public.item_types where slug = 'gamer_pc';

-- Relabel + reorder rooms we keep
update public.rooms set label_zh='客厅', sort_order=1  where slug='living_room';
update public.rooms set label_zh='饭厅', sort_order=2  where slug='dining_room';
update public.rooms set label_zh='厨房', sort_order=3  where slug='kitchen';
update public.rooms set label_zh='浴室', sort_order=5  where slug='bathroom';
update public.rooms set label_zh='玄关', sort_order=6  where slug='entrance';

-- Insert the 6 new L1 entries
insert into public.rooms (slug, label_zh, sort_order) values
  ('bedroom',     '卧室', 4),
  ('decor',       '装饰', 7),
  ('lighting',    '灯',   8),
  ('walls_floor', '墙地', 9),
  ('curtain',     '窗帘', 10),
  ('door',        '门',   11)
on conflict (slug) do update
   set label_zh   = excluded.label_zh,
       sort_order = excluded.sort_order;

-- =========================================================================
-- STEP 3. item_types: add room_slug + attribute_schema
-- =========================================================================
alter table public.item_types
  add column if not exists room_slug        text,
  add column if not exists attribute_schema jsonb not null default '[]'::jsonb;

-- Assign room parent for all seeded items. User-added items stay null;
-- admin UI will flag orphans so they can be reassigned.
update public.item_types set room_slug='living_room' where slug in ('sofa','coffee_table','tv_cabinet');
update public.item_types set room_slug='dining_room' where slug in ('dining_table','dining_chair','sideboard');
update public.item_types set room_slug='kitchen'     where slug in ('kitchen_cabinet','sink','faucet','range_hood','cooktop','oven','fridge');
update public.item_types set room_slug='bedroom'     where slug in ('bed_frame','mattress','nightstand','wardrobe','vanity');
update public.item_types set room_slug='bathroom'    where slug in ('toilet','bathroom_vanity','bathtub','shower','showerhead');
update public.item_types set room_slug='entrance'    where slug in ('shoe_cabinet');

-- Mirror split: `mirror` becomes two item_types.
-- Rename existing row → bathroom_mirror (safe: no product currently uses 'mirror').
-- Add full_body_mirror under entrance.
update public.item_types
   set slug='bathroom_mirror', label_zh='浴室镜', room_slug='bathroom'
 where slug='mirror';
insert into public.item_types (slug, label_zh, sort_order, room_slug) values
  ('full_body_mirror', '全身镜', 100, 'entrance')
on conflict (slug) do update
   set label_zh=excluded.label_zh, room_slug=excluded.room_slug;
update public.item_types set room_slug='decor'       where slug in ('rug','wall_art');
update public.item_types set room_slug='lighting'    where slug in ('ceiling_light','pendant_light','floor_lamp','table_lamp');
update public.item_types set room_slug='walls_floor' where slug in ('flooring','paint','switch_panel');
update public.item_types set room_slug='curtain'     where slug = 'curtain';
update public.item_types set room_slug='door'        where slug = 'door';

alter table public.item_types drop constraint if exists item_types_room_slug_fkey;
alter table public.item_types
  add constraint item_types_room_slug_fkey
  foreign key (room_slug) references public.rooms(slug)
  on update cascade on delete restrict;

create index if not exists item_types_room_slug_idx
  on public.item_types(room_slug);

-- =========================================================================
-- STEP 4. item_subtypes (L3, optional per item)
-- =========================================================================
create table if not exists public.item_subtypes (
  id              uuid        primary key default gen_random_uuid(),
  item_type_slug  text        not null references public.item_types(slug)
                                on update cascade on delete cascade,
  slug            text        not null,
  label_zh        text        not null,
  sort_order      int         not null default 100,
  created_at      timestamptz not null default now(),
  unique (item_type_slug, slug)
);
create index if not exists item_subtypes_item_type_idx
  on public.item_subtypes(item_type_slug);

alter table public.item_subtypes enable row level security;
drop policy if exists "public read item_subtypes" on public.item_subtypes;
create policy "public read item_subtypes" on public.item_subtypes
  for select using (true);

-- =========================================================================
-- STEP 5. app_config (KV) + api_usage (quota tracking, shared across APIs)
-- =========================================================================
-- value is plain text — TS code parses to int/float/bool as needed.
-- Avoids the jsonb-vs-string-vs-number juggling on the JS side.
create table if not exists public.app_config (
  key        text        primary key,
  value      text        not null,
  updated_at timestamptz not null default now()
);

-- Two rembg providers run side-by-side. Replicate is default (cheap, bulk),
-- remove.bg is the high-accuracy fallback for reviewer-rejected cutouts.
-- Meshy is stage B.
insert into public.app_config (key, value) values
  ('replicate_rembg_daily_limit',       '500'),
  ('removebg_daily_limit',              '50'),
  ('meshy_daily_limit',                 '20'),
  ('replicate_rembg_cost_per_call_usd', '0.001'),
  ('removebg_cost_per_call_usd',        '0.20'),
  ('meshy_cost_per_job_usd',            '0.25'),
  ('emergency_stop',                    'false')
on conflict (key) do nothing;

-- app_config is admin-only. RLS on, no public policies → only service-role
-- (which bypasses RLS) can read/write.
alter table public.app_config enable row level security;

-- api_usage is the audit log for every paid third-party call.
-- One row inserted on reservation by reserve_api_slot(); patched by
-- billSlot()/refundSlot() in src/lib/api-usage.ts.
--   status: free text. Conventional values used by the JS layer:
--           'reserved' | 'ok' | 'error' | 'timeout' | 'rejected'
--           | 'refund' (compensating row) | 'refunded' (original after refund)
create table if not exists public.api_usage (
  id                uuid          primary key default gen_random_uuid(),
  service           text          not null check (service in ('replicate_rembg','removebg','meshy')),
  product_id        uuid          null references public.products(id) on delete set null,
  product_image_id  uuid          null,   -- FK to product_images.id added after that table exists
  status            text          null,
  note              text          null,
  cost_usd          numeric(10,4) not null default 0,
  created_at        timestamptz   not null default now()
);
create index if not exists api_usage_service_day_idx
  on public.api_usage (service, ((created_at at time zone 'UTC')::date));
create index if not exists api_usage_product_idx
  on public.api_usage (product_id);

alter table public.api_usage enable row level security;
-- admin-only. No public policies.

-- =========================================================================
-- STEP 6. product_images (1:N with products — image pipeline lives here)
-- =========================================================================
-- state lifecycle:
--   raw              → just uploaded, no rembg yet
--   cutout_pending   → rembg done, awaiting human approval
--   cutout_approved  → operator OK'd it
--   cutout_rejected  → operator rejected it (may rerun with different provider)
create table if not exists public.product_images (
  id                uuid          primary key default gen_random_uuid(),
  product_id        uuid          not null references public.products(id) on delete cascade,
  raw_image_url     text          null,
  cutout_image_url  text          null,
  state             text          not null default 'raw'
                       check (state in ('raw','cutout_pending','cutout_approved','cutout_rejected')),
  is_primary        boolean       not null default false,
  rembg_provider    text          null,   -- 'replicate_rembg' | 'removebg' (free text — provider id strings)
  rembg_cost_usd    numeric(10,4) null,
  sort_order        int           not null default 0,
  created_at        timestamptz   not null default now(),
  updated_at        timestamptz   not null default now()
);
create index if not exists product_images_product_idx
  on public.product_images(product_id);
create index if not exists product_images_state_idx
  on public.product_images(state);

-- At most ONE primary image per product (partial unique index).
create unique index if not exists product_images_primary_unique
  on public.product_images(product_id) where is_primary;

-- Now link api_usage.product_image_id to product_images.id.
alter table public.api_usage drop constraint if exists api_usage_product_image_id_fkey;
alter table public.api_usage
  add constraint api_usage_product_image_id_fkey
  foreign key (product_image_id) references public.product_images(id) on delete set null;

-- Sync trigger: when an image becomes primary AND has a cutout, copy
-- the cutout URL into products.thumbnail_url so catalog queries don't
-- need to join product_images.
create or replace function public.sync_primary_thumbnail()
returns trigger language plpgsql as $$
begin
  if new.is_primary and new.cutout_image_url is not null then
    update public.products
       set thumbnail_url = new.cutout_image_url,
           updated_at    = now()
     where id = new.product_id;
  end if;
  return new;
end $$;

drop trigger if exists product_images_sync_thumb on public.product_images;
create trigger product_images_sync_thumb
after insert or update of is_primary, cutout_image_url
on public.product_images
for each row execute function public.sync_primary_thumbnail();

alter table public.product_images enable row level security;
drop policy if exists "public read approved images" on public.product_images;
create policy "public read approved images" on public.product_images
  for select using (state = 'cutout_approved');

-- =========================================================================
-- STEP 7. products: subtype_slug + attributes + meshy_* reserved fields
-- =========================================================================
alter table public.products
  add column if not exists subtype_slug        text          null,
  add column if not exists attributes          jsonb         not null default '{}'::jsonb,
  add column if not exists meshy_job_id        text          null,
  add column if not exists meshy_status        text          null,
  add column if not exists meshy_requested_at  timestamptz   null;

alter table public.products drop constraint if exists products_meshy_status_check;
alter table public.products
  add constraint products_meshy_status_check
  check (meshy_status is null or meshy_status in ('queued','processing','success','failed'));

-- Composite constraint: (item_type, subtype_slug) must exist in item_subtypes,
-- or subtype_slug must be null. Enforced by a trigger since Postgres can't
-- do a composite FK where the referenced pair is (item_type_slug, slug).
create or replace function public.validate_product_subtype()
returns trigger language plpgsql as $$
declare
  ok boolean;
begin
  if new.subtype_slug is null then return new; end if;
  if new.item_type is null then
    raise exception 'subtype_slug set but item_type is null';
  end if;
  select exists(
    select 1 from public.item_subtypes
     where item_type_slug = new.item_type
       and slug = new.subtype_slug
  ) into ok;
  if not ok then
    raise exception
      'subtype % not valid for item_type %', new.subtype_slug, new.item_type;
  end if;
  return new;
end $$;

drop trigger if exists products_subtype_check on public.products;
create trigger products_subtype_check
before insert or update of subtype_slug, item_type on public.products
for each row execute function public.validate_product_subtype();

-- =========================================================================
-- STEP 8. reserve_api_slot(...)  — atomic per-service quota guard
--   Used by BOTH rembg providers and the future Meshy worker.
--   Returns one row: (usage_id uuid, cost_usd numeric).
--   RAISES exception if emergency_stop or daily_limit hit — the JS
--   wrapper in src/lib/api-usage.ts catches it as QuotaExceededError.
-- =========================================================================
drop function if exists public.reserve_api_slot(text, uuid, uuid, numeric);
drop function if exists public.reserve_api_slot(text, uuid, uuid, text);

create or replace function public.reserve_api_slot(
  p_service          text,
  p_product_id       uuid default null,
  p_product_image_id uuid default null,
  p_note             text default null
) returns table(usage_id uuid, cost_usd numeric)
language plpgsql security definer as $$
declare
  v_id          uuid;
  v_cost        numeric;
  v_limit       int;
  v_used_today  int;
  v_stop        boolean;
begin
  if p_service not in ('replicate_rembg','removebg','meshy') then
    raise exception 'unknown service %', p_service;
  end if;

  -- Advisory lock: serialize concurrent callers on this service only.
  perform pg_advisory_xact_lock(hashtext('api_slot_' || p_service));

  -- Emergency stop (single global flag, kills every paid service).
  select (value)::boolean into v_stop
    from public.app_config where key='emergency_stop';
  if coalesce(v_stop, false) then
    raise exception 'emergency_stop is on — refusing to call %', p_service;
  end if;

  -- Per-service daily limit
  select (value)::int into v_limit
    from public.app_config
    where key = p_service || '_daily_limit';
  if v_limit is null then
    raise exception 'no daily_limit configured for service %', p_service;
  end if;

  -- Per-call cost (sourced from app_config so ops can adjust without code change).
  select (value)::numeric into v_cost
    from public.app_config
    where key = p_service || '_cost_per_call_usd';
  if v_cost is null then
    raise exception 'no cost_per_call_usd configured for service %', p_service;
  end if;

  -- Count today's positive-cost rows (refund rows have cost_usd < 0).
  -- Note: must qualify column references with the table name, because
  -- the function's RETURNS TABLE(... cost_usd numeric) introduces
  -- `cost_usd` as an output parameter that would otherwise shadow the
  -- column and trip "column reference is ambiguous".
  select count(*) into v_used_today
    from public.api_usage
   where api_usage.service = p_service
     and api_usage.cost_usd > 0
     and (api_usage.created_at at time zone 'UTC')::date = (now() at time zone 'UTC')::date;

  if v_used_today >= v_limit then
    raise exception 'daily_limit reached for % (% / %)', p_service, v_used_today, v_limit;
  end if;

  insert into public.api_usage
    (service, product_id, product_image_id, status, note, cost_usd)
  values
    (p_service, p_product_id, p_product_image_id, 'reserved', p_note, v_cost)
  returning id into v_id;

  usage_id := v_id;
  cost_usd := v_cost;
  return next;
end $$;

-- Make the RPC callable through PostgREST under the service role.
revoke all on function public.reserve_api_slot(text, uuid, uuid, text) from public;
grant execute on function public.reserve_api_slot(text, uuid, uuid, text) to service_role;

-- =========================================================================
-- STEP 9. Storage buckets (idempotent)
-- =========================================================================
insert into storage.buckets (id, name, public) values
  ('raw-images', 'raw-images', false),  -- private: source photos may have watermarks
  ('cutouts',    'cutouts',    true),   -- public: served as thumbnails
  ('models',     'models',     true)    -- public: served to model-viewer
on conflict (id) do nothing;
