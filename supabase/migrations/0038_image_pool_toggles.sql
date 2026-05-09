-- 0038 — Wave 5 image-pool toggle model.
--
-- Replaces Wave 4's "image_kind drives display" with a flat pool
-- where each row carries 3 booleans driving its three independent
-- behaviors:
--   • show_on_storefront    — appears in the product-page gallery
--   • is_primary_thumbnail  — drives products.thumbnail_url via the
--                             unify route. Max 1 per product.
--   • feed_to_ai            — selectable as an input to the GPT-4o
--                             spec parser.
--
-- image_kind stays around for the rembg pipeline's internal use
-- (cutout vs spec_sheet vs real_photo), but it no longer gates
-- display.
--
-- Defaults are friendly (true / true / true except is_primary_thumbnail)
-- so existing rows behave like operator-approved gallery items
-- without any backfill of explicit toggle state. is_primary_thumbnail
-- is backfilled from existing is_primary so the cutout-pipeline-
-- promoted rows stay primary.
--
-- ── is_primary vs is_primary_thumbnail ─────────────────────────
-- These are now SEPARATE concepts:
--   • is_primary = "cutout pipeline marker" — set by the rembg
--     approval flow, used by image-actions.ts auto-promote, etc.
--     The cutout pipeline app code is untouched by this migration.
--   • is_primary_thumbnail = "operator-chosen storefront cover".
--     Drives the unify route's selector (see route filter change
--     in this migration) and the product-page gallery's lead slide.
--
-- They start equal (backfill + auto-set-on-is_primary trigger
-- below), but the operator may diverge them via the new toggle UI.

alter table public.product_images
  add column if not exists show_on_storefront    boolean not null default true,
  add column if not exists is_primary_thumbnail  boolean not null default false,
  add column if not exists feed_to_ai            boolean not null default true;

-- Backfill: existing is_primary=true rows become is_primary_thumbnail=true.
update public.product_images
  set is_primary_thumbnail = true
  where is_primary = true;

-- Partial unique index — at most one is_primary_thumbnail per product.
-- The trigger below also enforces this (race-safe), but the unique
-- index gives the same guarantee at the row-level + a clear error
-- if anything tries a direct INSERT/UPDATE that would violate.
drop index if exists idx_product_images_unique_primary_thumbnail;
create unique index idx_product_images_unique_primary_thumbnail
  on public.product_images (product_id)
  where is_primary_thumbnail = true;

-- ── Trigger: enforce "exactly one is_primary_thumbnail per product"
-- When operator toggles a row to is_primary_thumbnail=true, clear
-- the flag on every other row for that product BEFORE the unique
-- index would block the write. AFTER trigger fires post-row but
-- pre-statement-end so the unique index sees the cleaned state.
create or replace function public.maintain_primary_thumbnail()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_primary_thumbnail = true
     and (TG_OP = 'INSERT' or coalesce(old.is_primary_thumbnail, false) = false) then
    update public.product_images
      set is_primary_thumbnail = false
      where product_id = new.product_id
        and id <> new.id
        and is_primary_thumbnail = true;
  end if;
  return new;
end;
$$;

drop trigger if exists product_images_one_primary_thumbnail on public.product_images;
create trigger product_images_one_primary_thumbnail
  before insert or update of is_primary_thumbnail on public.product_images
  for each row execute function public.maintain_primary_thumbnail();

-- ── Trigger: auto-set is_primary_thumbnail when is_primary becomes
-- true AND no peer on the product already has it set.
-- This preserves the smooth flow: rembg approves the first cutout,
-- is_primary→true (existing cutout-pipeline write), then this
-- trigger sets is_primary_thumbnail=true automatically. Operator
-- can later toggle to a different row; that wins because the
-- condition "no peer has it set" is no longer met if the operator
-- already picked one.
create or replace function public.auto_set_primary_thumbnail()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_has_peer boolean;
begin
  if new.is_primary = true
     and (TG_OP = 'INSERT' or coalesce(old.is_primary, false) = false)
     and new.is_primary_thumbnail = false then
    select exists(
      select 1 from public.product_images
      where product_id = new.product_id
        and id <> new.id
        and is_primary_thumbnail = true
    ) into v_has_peer;
    if not v_has_peer then
      new.is_primary_thumbnail := true;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists product_images_auto_primary_thumbnail on public.product_images;
create trigger product_images_auto_primary_thumbnail
  before insert or update of is_primary on public.product_images
  for each row execute function public.auto_set_primary_thumbnail();

-- ── Replace mig 0035's unify trigger function — filter is now
-- is_primary_thumbnail (operator-controlled) instead of is_primary
-- (cutout-pipeline-controlled). The function keeps the same
-- signature + same trigger registration, just swaps the predicate.
create or replace function public.unify_thumb_on_approve()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base_url text;
  v_secret   text;
begin
  if new.state = 'cutout_approved'
     and new.is_primary_thumbnail = true
     and new.image_kind = 'cutout'
     and (old.state is distinct from new.state) then
    select value into v_base_url from private._app_config where key = 'app_base_url';
    select value into v_secret   from private._app_config where key = 'cron_secret';
    if v_base_url is null or v_secret is null then
      return new;
    end if;
    perform net.http_post(
      url := v_base_url || '/api/admin/unify-thumbnail',
      headers := jsonb_build_object(
        'X-Cron-Secret', v_secret,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object('product_id', new.product_id),
      timeout_milliseconds := 60000
    );
  end if;
  return new;
end;
$$;

-- Re-register the trigger so its watched-columns list reflects the
-- new dependency on is_primary_thumbnail (was: is_primary).
drop trigger if exists product_images_unify_after_approve on public.product_images;
create trigger product_images_unify_after_approve
  after update of state, is_primary_thumbnail on public.product_images
  for each row execute function public.unify_thumb_on_approve();

notify pgrst, 'reload schema';
