-- 0031 — Persist GLB decoded-budget metadata so SSR can pre-empt
--        iOS Safari OOM crashes server-side.
--
-- Why: the React error boundary added in commit e44aa22 catches
-- render-phase JS throws but NOT the OS-level renderer-process kill
-- that iOS Safari does when a heavy GLB exceeds tab heap budget.
-- The /product/9dbd6623 incident confirmed this — the boundary
-- never got a chance to run; the page just died.
--
-- Strategy: at admin-upload time we already compute vertex count,
-- largest-texture dimension, and estimated decoded RAM (see
-- lib/admin/compress-glb#checkGlbBudget). Those numbers gate the
-- upload itself, but we throw them away after the check. Persist
-- them so server-side rendering can apply a stricter cap and skip
-- the <model-viewer> branch for borderline-too-heavy GLBs that
-- the upload-time admin cap let through.
--
-- All three columns nullable on purpose:
--   • Old products (uploaded before this migration) have unknown
--     metadata. SSR treats NULL as "no info → render anyway"
--     (backward compatibility — those products were working
--     before, they keep working).
--   • New products always populate all three (admin upload flow
--     writes them in the same transaction as glb_url itself).

alter table public.products
  add column if not exists glb_vertex_count    integer,
  add column if not exists glb_max_texture_dim integer,
  add column if not exists glb_decoded_ram_mb  integer;

comment on column public.products.glb_vertex_count    is 'Total POSITION vertex count across all primitives (snapshot at upload time). Drives SSR-time render gate.';
comment on column public.products.glb_max_texture_dim is 'Largest texture dimension (max of width/height) across all images. Drives SSR-time render gate.';
comment on column public.products.glb_decoded_ram_mb  is 'Estimated decoded GPU/CPU RAM in MB: vertices*36 + Σ(w*h*4). Drives SSR-time render gate.';
