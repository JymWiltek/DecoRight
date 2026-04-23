-- ─────────────────────────────────────────────────────────────────
-- 0011 — Subtype-owned room derivation + regions catalog
--
-- Background: previously a product's room came from item_types.room_slug.
-- That works for 1-deep taxonomies (faucet → kitchen) but not for
-- subtype-driven ones (light → ceiling/wall/table; ceiling lights live
-- in many rooms while table lamps are bedroom-coded). Promotes
-- room ownership to item_subtypes when present, falls back to
-- item_types when no subtype is picked. Enforced at the DB layer so
-- the storefront's three-layer funnel never has to deal with an
-- "orphaned" published product.
--
-- Background (regions): DecoRight is national but Wiltek's physical
-- showrooms are regional. Products carry a store_locations text[]
-- (subset of public.regions.slug) so the detail page can show
-- "Available in: Penang, KL, Selangor".
-- ─────────────────────────────────────────────────────────────────

-- 1) item_subtypes.room_slug — NOT NULL with FK to rooms.
--    The 0010 schema added the table empty; if anything's there now
--    we backfill with the lowest-sort_order room before locking down.
alter table public.item_subtypes
  add column if not exists room_slug text;

update public.item_subtypes
  set room_slug = (select slug from public.rooms order by sort_order limit 1)
  where room_slug is null;

alter table public.item_subtypes
  alter column room_slug set not null;

alter table public.item_subtypes
  drop constraint if exists item_subtypes_room_slug_fk;
alter table public.item_subtypes
  add  constraint item_subtypes_room_slug_fk
       foreign key (room_slug) references public.rooms(slug)
       on update cascade on delete restrict;

-- ensure (item_type_slug, slug) is unique so the form's cascading
-- picker can key on it
alter table public.item_subtypes
  drop constraint if exists item_subtypes_item_type_slug_slug_unique;
alter table public.item_subtypes
  add  constraint item_subtypes_item_type_slug_slug_unique
       unique (item_type_slug, slug);

-- FK so a subtype can't point at a deleted item_type
alter table public.item_subtypes
  drop constraint if exists item_subtypes_item_type_fk;
alter table public.item_subtypes
  add  constraint item_subtypes_item_type_fk
       foreign key (item_type_slug) references public.item_types(slug)
       on update cascade on delete cascade;

-- 2) Room derivation function: subtype-first, then item_type.
--    Stable + parallel-safe so it's cheap to call from the trigger
--    and from views.
create or replace function public.product_room_slug(p public.products)
returns text
language sql
stable
as $$
  select coalesce(
    (select s.room_slug from public.item_subtypes s
       where s.item_type_slug = p.item_type
         and s.slug = p.subtype_slug
       limit 1),
    (select t.room_slug from public.item_types t
       where t.slug = p.item_type
       limit 1)
  );
$$;

-- 3) Trigger: published products MUST resolve to a room. Drafts can
--    have anything (operator may still be filling it in). Archived
--    too — they're hidden from storefront so derivation is irrelevant.
create or replace function public.products_check_room_derivable()
returns trigger
language plpgsql
as $$
declare
  derived text;
begin
  if new.status = 'published' then
    derived := public.product_room_slug(new);
    if derived is null then
      raise exception
        'Published product % must derive a room: either pick an item_type whose room_slug is set, or pick a subtype whose room_slug is set.',
        new.id
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists products_room_derivable on public.products;
create trigger products_room_derivable
  before insert or update of status, item_type, subtype_slug
  on public.products
  for each row
  execute function public.products_check_room_derivable();

-- 4) Subtype picked must belong to the picked item_type.
create or replace function public.products_check_subtype_consistency()
returns trigger
language plpgsql
as $$
declare
  ok boolean;
begin
  if new.subtype_slug is null then
    return new;
  end if;
  if new.item_type is null then
    raise exception 'subtype_slug % set but item_type is null', new.subtype_slug
      using errcode = 'check_violation';
  end if;
  select exists(
    select 1 from public.item_subtypes s
     where s.item_type_slug = new.item_type
       and s.slug = new.subtype_slug
  ) into ok;
  if not ok then
    raise exception
      'subtype_slug % does not belong to item_type %', new.subtype_slug, new.item_type
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists products_subtype_consistent on public.products;
create trigger products_subtype_consistent
  before insert or update of item_type, subtype_slug
  on public.products
  for each row
  execute function public.products_check_subtype_consistency();

-- 5) Regions catalog. Mirrors public.rooms shape (slug + tri-lingual
--    labels + sort_order) plus a coarser "region" group.
create table if not exists public.regions (
  slug       text primary key,
  label_en   text not null,
  label_zh   text,
  label_ms   text,
  sort_order int  not null default 0,
  region     text not null,  -- 'north' | 'central' | 'south' | 'east' | 'sabah_sarawak'
  created_at timestamptz not null default now()
);

alter table public.regions enable row level security;

drop policy if exists "regions read all" on public.regions;
create policy "regions read all" on public.regions
  for select using (true);

-- Service role bypasses RLS so admin writes work without a separate
-- policy. The storefront only reads.

-- 6) products.store_locations — text[] of region slugs.
alter table public.products
  add column if not exists store_locations text[] not null default '{}';

-- 7) Seed the 13 states + 3 federal territories of Malaysia.
--    Region groupings are the conventional retail "Northern / Central /
--    Southern / East Coast / East Malaysia" buckets.
insert into public.regions(slug, label_en, region, sort_order) values
  ('penang',          'Penang',          'north',          10),
  ('kedah',           'Kedah',           'north',          11),
  ('perlis',          'Perlis',          'north',          12),
  ('perak',           'Perak',           'north',          13),
  ('selangor',        'Selangor',        'central',        20),
  ('kuala_lumpur',    'Kuala Lumpur',    'central',        21),
  ('putrajaya',       'Putrajaya',       'central',        22),
  ('negeri_sembilan', 'Negeri Sembilan', 'central',        23),
  ('melaka',          'Melaka',          'south',          30),
  ('johor',           'Johor',           'south',          31),
  ('pahang',          'Pahang',          'east',           40),
  ('terengganu',      'Terengganu',      'east',           41),
  ('kelantan',        'Kelantan',        'east',           42),
  ('sabah',           'Sabah',           'sabah_sarawak',  50),
  ('sarawak',         'Sarawak',         'sabah_sarawak',  51),
  ('labuan',          'Labuan',          'sabah_sarawak',  52)
on conflict (slug) do nothing;

-- 8) Widen `models` bucket from 15 MB → 60 MB. Many photogrammetry-
--    derived furniture .glb files run 20–50 MB; the 15 MB limit was
--    rejecting valid uploads with no UI surface (P0-6).
update storage.buckets
   set file_size_limit = 60 * 1024 * 1024
 where id = 'models';

-- Also widen thumbnails from 500 KB → 4 MB so a phone photo uploaded
-- as a thumbnail doesn't bounce.
update storage.buckets
   set file_size_limit = 4 * 1024 * 1024
 where id = 'thumbnails';
