-- 0037 — Drop the legacy sync_primary_thumbnail trigger.
--
-- History:
--   • Mig 0003 created `sync_primary_thumbnail()` and the
--     `product_images_sync_thumb` trigger to copy a primary cutout's
--     `cutout_image_url` into `products.thumbnail_url`.
--   • Mig 0009 hardened it (added state='cutout_approved' guard,
--     widened watched columns to include `state`).
--   • Mig 0035 (Wave 2) introduced `unify_thumb_on_approve` —
--     async via pg_net → /api/admin/unify-thumbnail → uploads a
--     1500×1500 white-canvas unified PNG and writes a versioned
--     URL to `products.thumbnail_url`.
--
-- Both triggers write to the same column. The legacy trigger fires
-- synchronously on every UPDATE of cutout_image_url / is_primary /
-- state — including operator actions that change cutout_image_url's
-- ?v= cache-bust query string. Each such fire stomps the unified
-- URL with the cutout URL. The new unify trigger only re-fires on
-- a state→cutout_approved transition, so once the legacy trigger
-- has stomped the unified URL, the storefront stays on the cutout
-- URL until the next approval transition.
--
-- This was the cause of the 2026-05-10 incident: backfill wrote
-- unified URLs across all 11 products, then incidental column
-- updates retriggered the legacy sync and reverted some rows back
-- to cutout URLs.
--
-- Drop is cleaner than narrowing the legacy trigger because the
-- unify pipeline is now the single source of truth for
-- products.thumbnail_url. Defensive options ("only fire when
-- thumbnail_url IS NULL") fail when the unify itself fails: a
-- cutout-stomped row has non-NULL thumbnail_url, so a NULL-guarded
-- trigger never recovers it. The right recovery path is the
-- manual Re-unify button (Commit 3) which directly re-invokes the
-- unify route.

drop trigger if exists product_images_sync_thumb on public.product_images;
drop function if exists public.sync_primary_thumbnail();

notify pgrst, 'reload schema';
