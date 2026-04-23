-- =====================================================================
-- 0010 · auto-cutout pipeline
--
-- Supports the upload → auto-cutout → auto-approve → auto-primary flow
-- by introducing two new product_images.state values:
--
--   • cutout_failed   — Replicate (or configured default provider)
--                       returned an error or timed out. The row is
--                       parked here so the operator sees a Retry
--                       button; retrying reuses the same raw_image_url,
--                       so no re-upload is needed.
--
--   • user_rejected   — the cutout SUCCEEDED but the operator clicked
--                       the × button on the approved thumbnail ("I
--                       don't like this result"). Different from
--                       cutout_rejected (which the legacy queue used
--                       to mean "rembg produced crap, try again") —
--                       a user_rejected row is terminal; the operator
--                       is saying the raw photo itself is wrong. The
--                       row is kept for audit + delete.
--
-- Task C verification (in-situ, no migration needed):
--   UPDATE products SET thumbnail_url=NULL for a product with an
--   existing approved primary; then touched is_primary on that image.
--   The sync_primary_thumbnail() trigger (migration 0009) fired and
--   restored thumbnail_url to the correct cutouts URL. Trigger works.
--
-- Task A diagnostic (for the record):
--   For product_id 95fdf41f-3aab-4792-97ae-8053af64fe3e ("Smart Tap")
--   there were zero product_images rows, zero api_usage entries for
--   it, and zero storage.objects under cutouts/<id>/. The earlier
--   upload attempt never persisted anywhere — the auto-pipeline added
--   in this migration + the companion image-actions refactor ensures
--   a dropzone upload now runs end-to-end inside a single server
--   action (raw → rembg → approved → primary → thumbnail sync).
-- =====================================================================

-- Drop existing CHECK so we can widen it. pg catalog scan for the
-- exact constraint name (0004 named it product_images_state_check;
-- be defensive in case an earlier run used the default name).
do $$
declare
  c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.product_images'::regclass
      and contype  = 'c'
      and pg_get_constraintdef(oid) ilike '%state%in%raw%'
  loop
    execute format('alter table public.product_images drop constraint %I', c);
  end loop;
end $$;

alter table public.product_images
  add constraint product_images_state_check
  check (state in (
    'raw',
    'cutout_pending',
    'cutout_approved',
    'cutout_rejected',
    'cutout_failed',
    'user_rejected'
  ));

notify pgrst, 'reload schema';
