-- =====================================================================
-- 0004 · align live pipeline with Stage A code
--
-- 0003 was authored with `create table if not exists product_images (...)`
-- and `create table if not exists api_usage (...)`. By the time the
-- rewritten 0003 was re-run against the DB, those tables already existed
-- in their original (pre-rewrite) shape, so the new column definitions
-- were silently skipped. Result: src/lib/supabase/types.ts and the
-- /admin/cutouts + /admin/upload code reference columns the DB doesn't
-- have (e.g. product_images.state, .rembg_provider, .rembg_cost_usd;
-- api_usage.product_image_id, .note; reserve_api_slot's new signature).
--
-- This migration is purely additive/rename: it bridges the live shape
-- to what the code expects, and it's safe to re-run.
-- =====================================================================

-- ─── product_images ────────────────────────────────────────────────
-- 1. drop policy + index that reference the old column name first, so
--    the rename + check-constraint swap doesn't trip dependencies.
drop policy if exists "public read approved images" on public.product_images;
drop index  if exists public.product_images_state_idx;

-- 2. rename cutout_status → state if needed (no-op if already renamed).
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='product_images'
       and column_name='cutout_status'
  )
  and not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='product_images'
       and column_name='state'
  )
  then
    alter table public.product_images rename column cutout_status to state;
  end if;
end $$;

-- 3. ensure the column exists at all (covers fresh installs).
alter table public.product_images
  add column if not exists state text not null default 'raw';

-- 4. swap the check constraint over to the new vocabulary.
do $$
declare
  c text;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.product_images'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%state%'
  loop
    execute format('alter table public.product_images drop constraint %I', c);
  end loop;
  for c in
    select conname from pg_constraint
     where conrelid = 'public.product_images'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%cutout_status%'
  loop
    execute format('alter table public.product_images drop constraint %I', c);
  end loop;
end $$;
alter table public.product_images
  add constraint product_images_state_check
  check (state in ('raw','cutout_pending','cutout_approved','cutout_rejected'));

-- 5. add the rembg audit columns.
alter table public.product_images
  add column if not exists rembg_provider  text          null,
  add column if not exists rembg_cost_usd  numeric(10,4) null;

-- 6. recreate dropped index + RLS policy against the new column.
create index if not exists product_images_state_idx
  on public.product_images(state);

alter table public.product_images enable row level security;
create policy "public read approved images" on public.product_images
  for select using (state = 'cutout_approved');

-- ─── api_usage ─────────────────────────────────────────────────────
-- 7. rename image_id → product_image_id (drop old FK first if present).
do $$
declare
  c text;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.api_usage'::regclass
       and contype = 'f'
       and conname in ('api_usage_image_id_fkey', 'api_usage_product_image_id_fkey')
  loop
    execute format('alter table public.api_usage drop constraint %I', c);
  end loop;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='api_usage'
       and column_name='image_id'
  )
  and not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='api_usage'
       and column_name='product_image_id'
  )
  then
    alter table public.api_usage rename column image_id to product_image_id;
  end if;
end $$;

alter table public.api_usage
  add column if not exists product_image_id uuid null;

-- 8. add `note`; drop legacy columns the code no longer references.
alter table public.api_usage
  add  column if not exists note  text null,
  drop column if exists error,
  drop column if exists job_id;

-- 9. re-link FK on the renamed column.
alter table public.api_usage
  add constraint api_usage_product_image_id_fkey
  foreign key (product_image_id)
  references public.product_images(id)
  on delete set null;

-- ─── reserve_api_slot RPC ─────────────────────────────────────────
-- 10. drop EVERY overload of the function (signature drifted across
--     iterations of 0003), then recreate with the canonical signature.
do $$
declare
  r record;
begin
  for r in
    select oid::regprocedure::text as sig
      from pg_proc
     where proname = 'reserve_api_slot'
       and pronamespace = 'public'::regnamespace
  loop
    execute 'drop function ' || r.sig || ' cascade';
  end loop;
end $$;

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

  perform pg_advisory_xact_lock(hashtext('api_slot_' || p_service));

  select (value)::boolean into v_stop
    from public.app_config where key='emergency_stop';
  if coalesce(v_stop, false) then
    raise exception 'emergency_stop is on — refusing to call %', p_service;
  end if;

  select (value)::int into v_limit
    from public.app_config
    where key = p_service || '_daily_limit';
  if v_limit is null then
    raise exception 'no daily_limit configured for service %', p_service;
  end if;

  select (value)::numeric into v_cost
    from public.app_config
    where key = p_service || '_cost_per_call_usd';
  if v_cost is null then
    raise exception 'no cost_per_call_usd configured for service %', p_service;
  end if;

  select count(*) into v_used_today
    from public.api_usage
   where service = p_service
     and cost_usd > 0
     and (created_at at time zone 'UTC')::date = (now() at time zone 'UTC')::date;

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

revoke all on function public.reserve_api_slot(text, uuid, uuid, text) from public;
grant execute on function public.reserve_api_slot(text, uuid, uuid, text) to service_role;

-- ─── PostgREST: refresh schema cache so the new columns + RPC become
--     visible to the API immediately (instead of waiting up to ~60s).
notify pgrst, 'reload schema';
