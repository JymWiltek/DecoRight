-- =====================================================================
-- 0006 · convert api_usage.id from bigint/serial to uuid
--
-- The original 0003 used `create table if not exists api_usage` with
-- `id bigint generated always as identity` (or serial). The rewritten
-- 0003 changed the spec to `id uuid primary key default gen_random_uuid()`
-- but that CREATE was a no-op against the existing table, so the live
-- column is still bigint.
--
-- Our 0005 reserve_api_slot has `declare v_id uuid` and does
-- `returning id into v_id` — Postgres returns the new bigint id, then
-- raises "invalid input syntax for type uuid: '1'" trying to cast.
-- Every reserveSlot() call from src/lib/api-usage.ts would fail.
--
-- Since api_usage has zero rows (it's purely audit/forward-looking),
-- the safest fix is to drop & recreate the table with the right id
-- type. We keep the same column shape post-0004, plus the FK from the
-- (renamed) product_image_id back to product_images.
-- =====================================================================

-- Be defensive: if anyone added rows since 0004 ran, abort loudly so
-- we don't silently destroy them. Production has none (verified via
-- check-0003.ts probe), but this guard keeps re-runs honest.
do $$
declare
  n int;
begin
  select count(*) into n from public.api_usage;
  if n > 0 then
    raise exception
      'api_usage has % rows — refusing to drop. '
      'Inspect rows and migrate manually before re-running.', n;
  end if;
end $$;

-- Drop the FK that constrains product_images.id (no-op if missing).
alter table public.api_usage
  drop constraint if exists api_usage_product_image_id_fkey;

drop table if exists public.api_usage;

create table public.api_usage (
  id                uuid          primary key default gen_random_uuid(),
  service           text          not null check (service in ('replicate_rembg','removebg','meshy')),
  product_id        uuid          null references public.products(id) on delete set null,
  product_image_id  uuid          null references public.product_images(id) on delete set null,
  status            text          null,
  note              text          null,
  cost_usd          numeric(10,4) not null default 0,
  created_at        timestamptz   not null default now()
);

create index api_usage_service_day_idx
  on public.api_usage (service, ((created_at at time zone 'UTC')::date));
create index api_usage_product_idx
  on public.api_usage (product_id);

alter table public.api_usage enable row level security;
-- service-role-only; no public policies (service role bypasses RLS).

notify pgrst, 'reload schema';
