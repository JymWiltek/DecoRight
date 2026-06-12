-- 0044 — Wave 11b: FBX zip bundle for designer downloads.
--
-- Background: a bare .fbx is useless to a designer — 3ds Max loads it
-- with no materials (black/grey) because the texture maps (JPEG/PNG)
-- aren't alongside it. The fix is to ship a zip containing
--   model.fbx
--   textures/<file>.jpg|png  (1-5 maps)
-- so 3ds Max auto-resolves the maps from the sibling textures/ folder
-- on import.
--
-- Operators now upload the .fbx PLUS its texture files; a server-side
-- packaging step (lib/fbx-bundle) zips them into
-- models/products/<id>/fbx-bundle.zip and stores the public URL here.
-- The storefront "Download FBX" button prefers fbx_bundle_url when
-- present, falling back to the bare fbx_url for products packaged
-- before this wave (data-protection: never breaks an existing
-- download).
--
-- Two nullable columns, no backfill — every consumer treats NULL as
-- "no bundle yet, use the bare .fbx".

alter table public.products
  add column if not exists fbx_bundle_url     text,
  add column if not exists fbx_bundle_size_kb integer;

notify pgrst, 'reload schema';
