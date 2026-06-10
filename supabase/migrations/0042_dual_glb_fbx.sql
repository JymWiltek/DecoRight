-- 0042 — Wave 9: dual-file 3D (GLB original + Draco-compressed + FBX).
--
-- Business: designers pay to download untouched FBX originals (3ds Max
-- / Maya / SketchUp); free users see web AR via a Draco-compressed
-- .glb. Operator uploads BOTH files from the same Tripo/Meshy
-- generation. Decoright Draco-compresses the .glb server-side via
-- @gltf-transform/core + draco3dgltf and stores the result alongside
-- the original. POC Round 5 (basin cabinet): 41 MB → 3.3 MB (−92%).
--
-- Reuse decisions (locked in plan):
--   • dimensions_mm JSONB already holds {length?,width?,height?} in
--     mm — the new dual-upload UI writes to this same column. NO new
--     real_*_mm INT columns.
--   • glb_url stays as the high-quality original. Legacy Meshy /
--     legacy hand-upload products continue to read/write this column;
--     Wave 9 dual-upload ALSO writes the 40 MB original here. The
--     column is NEVER deleted (data-protection hard rule).
--   • Only ONE new url column for the 3 MB Draco AR file:
--     glb_compressed_url. Storefront prefers it when status='done'.
--
-- Six new columns, all nullable, no backfill — every consumer treats
-- NULL as "no Wave 9 data, use the legacy path" so legacy products
-- keep rendering exactly as before.
--
-- compression_status lifecycle:
--   NULL       — no Wave 9 upload yet (legacy/Meshy-only product)
--   'pending'  — operator just uploaded glb_original, worker not started
--   'processing' — Draco compression in flight (route handler running)
--   'done'     — glb_compressed_url populated, storefront uses it
--   'failed'   — compression_error has the reason; Retry button available
--
-- Partial index gives operators a "show me failed compressions" query
-- without indexing the >99% of legacy rows where status is NULL.
--
-- Bucket bump 60 MB → 120 MB so the same `models` bucket holds three
-- variants per product (model.glb high-quality + compressed.glb +
-- model.fbx). 100 MB FBX uploads have headroom. Same one-liner mig
-- 0011 used to bump 15 MB → 60 MB.

alter table public.products
  add column if not exists glb_compressed_url      text,
  add column if not exists glb_compressed_size_kb  integer,
  add column if not exists fbx_url                 text,
  add column if not exists fbx_size_kb             integer,
  add column if not exists compression_status      text,
  add column if not exists compression_error       text;

alter table public.products
  drop constraint if exists products_compression_status_chk;
alter table public.products
  add constraint products_compression_status_chk
    check (compression_status is null
        or compression_status in ('pending','processing','done','failed'));

create index if not exists idx_products_compression_status
  on public.products (compression_status)
  where compression_status is not null;

-- Bump models bucket 60 MB → 120 MB (one bucket holds glb + compressed
-- + fbx). Same shape mig 0011 used to bump 15 MB → 60 MB.
update storage.buckets
   set file_size_limit = 120 * 1024 * 1024
 where id = 'models';

notify pgrst, 'reload schema';
