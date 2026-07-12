-- Scene-cover job status (Wave 13) — make scene-generation failures VISIBLE
-- instead of being silently swallowed. Set by maybeGenerateSceneCover /
-- the /api/admin/scene-cover route.
--   pending  — generation dispatched, not finished
--   done     — a Mode-A scene cover was generated + set as the thumbnail
--   skipped  — not a white-bg product (already scened / supplier photo / no source)
--   failed   — rembg/generation/upload threw; thumbnail left untouched; reason in scene_cover_error
alter table public.products
  add column if not exists scene_cover_status text
    check (scene_cover_status in ('pending','done','skipped','failed')),
  add column if not exists scene_cover_error text;

notify pgrst, 'reload schema';
