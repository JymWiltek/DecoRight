-- 0030 (hotfix) — Stop iOS Safari OOM crash on /product/9dbd6623.
--
-- The compressed GLB at products/9dbd6623-6684-4239-a9b9-f49da27edcf1/model.glb
-- carries 1,010,233 vertices + a 4096x4096 JPEG. Decoded that's ~140 MB of
-- transient RAM; iOS Safari's renderer process kills the page before any
-- JS exception fires, so the React error boundary added in commit e44aa22
-- never gets a chance to catch.
--
-- Until Jym re-uploads from a simpler source (Tripo / decimated mesh), null
-- the field so ProductGallery skips the <model-viewer> branch and falls
-- back to the styled-thumbnail. The Storage object stays in place so the
-- product retains its history; only the surfaced URL is wiped.
--
-- Idempotent: WHERE clause and IS DISTINCT FROM NULL together make this
-- safe to re-run.

update public.products
   set glb_url = null,
       updated_at = now()
 where id = '9dbd6623-6684-4239-a9b9-f49da27edcf1'
   and glb_url is not null;
