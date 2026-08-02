-- 0054 — Raise the `models` bucket file size limit 120 MB → 300 MB.
--
-- Why: Jym generates large products with Tripo "ultra mesh" (much better
-- quality, low error rate — the settled route for big items), and those
-- .glb originals run 60 MB+. The old 60 MB upload gate rejected them at
-- the door, so the server-side Draco+webp compression pipeline never got
-- to run. Decision: widen the ENTRY gate, move the guard to the EXIT
-- (the compressed AR file must be ≤ 15 MB — enforced in code, see
-- lib/glb-budget#MAX_COMPRESSED_OUTPUT_MB + lib/glb-compression). The
-- 4G consumer-load red line is unchanged; what changed is WHERE it is
-- held: from "reject the raw material" to "reject the unfit product".
--
-- #35 proved the .glb travels via a browser → Supabase Storage signed
-- PUT (route=direct-storage), NOT through a Vercel function, so there is
-- no architectural obstacle to large-file transfer.
--
-- This raises ONLY the per-bucket ceiling. The `models` bucket holds
-- three variants per product (model.glb high-quality + compressed.glb +
-- model.fbx); the high-quality original is now the large one. Same
-- one-liner shape as mig 0011 (15→60) and mig 0042 (60→120).
--
-- ⚠️ OPERATOR ACTION STILL REQUIRED (dashboard, cannot be a migration):
--   Supabase also enforces a PROJECT-GLOBAL storage upload limit
--   (Dashboard → Storage → Settings → "Global file upload limit").
--   The effective cap on any upload is min(global, bucket). If the
--   global limit is below 300 MB, uploads over it still 413 at the
--   signed PUT even after this migration. Raise the global limit to
--   ≥ 300 MB. (Same global-limit blocker tracked separately — the
--   earlier 413-at-50 MB finding.)

update storage.buckets
   set file_size_limit = 300 * 1024 * 1024
 where id = 'models';

notify pgrst, 'reload schema';
