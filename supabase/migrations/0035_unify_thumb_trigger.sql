-- 0035 — pg_net trigger that calls /api/admin/unify-thumbnail when
-- a product_images row hits state='cutout_approved' AND is_primary=true.
--
-- Why a trigger instead of a cron: unify needs to fire AT MOST ONCE
-- per state-change event (the cutout-approval moment). A timed cron
-- would have to scan the table on every tick to find rows whose
-- thumbnail predates their cutout_approved-at — possible, but the
-- trigger approach has zero duplicate work and zero polling overhead.
--
-- Auth: passes X-Cron-Secret from private._app_config (mig 0018) so
-- the route can identify the call as legitimate without a browser
-- session. The route's verifyCronSecret() compares against the same
-- value with constant-time equality.
--
-- Base URL: lives in private._app_config under key 'app_base_url'
-- (added alongside this migration via DML). Stored in DB rather
-- than hard-coded so a preview-deploy URL change doesn't require a
-- new migration.
--
-- Trigger semantics:
--   • AFTER UPDATE OF state, is_primary on public.product_images
--   • Fires only when the row transitions INTO cutout_approved
--     (old.state IS DISTINCT FROM new.state, new.state =
--     'cutout_approved') AND is_primary AND image_kind = 'cutout'.
--   • Real photos (image_kind='real_photo') land at cutout_approved
--     but their is_primary is false, so this condition rejects them
--     even before the image_kind check — belt + braces.
--
-- pg_net is async — net.http_post enqueues a request, the actual
-- HTTP call happens in pg_net's background worker. timeout 60_000ms
-- (60s) matches the route's maxDuration.

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
  -- Conditions: only fire on the approval transition for the primary
  -- cutout. AFTER triggers see both OLD and NEW.
  if new.state = 'cutout_approved'
     and new.is_primary = true
     and new.image_kind = 'cutout'
     and (old.state is distinct from new.state) then
    select value into v_base_url from private._app_config where key = 'app_base_url';
    select value into v_secret   from private._app_config where key = 'cron_secret';
    if v_base_url is null or v_secret is null then
      -- Config row missing — skip silently rather than block the
      -- write the operator just made. The unify can be retried
      -- via the manual admin button.
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

drop trigger if exists product_images_unify_after_approve on public.product_images;
create trigger product_images_unify_after_approve
  after update of state, is_primary on public.product_images
  for each row execute function public.unify_thumb_on_approve();
