-- 0041 — Wave 8: low-contrast cutout shrink detection.
--
-- Background: rembg can't always tell a light-grey / white / beige /
-- chrome product apart from the white-ish background. When that
-- happens it eats the product's edges and the cutout PNG ends up with
-- the actual product occupying a small fraction of the canvas. The
-- unify pipeline then centers that tiny product on a 1500×1500 white
-- canvas, so the storefront card looks like a postage stamp floating
-- in whitespace (e.g. Grey Marble Counter Top Basin,
-- e8ed13a4-9617-4541-a1ef-b5dd080f97d2). Re-unify can't fix it —
-- the cutout itself is already shrunk.
--
-- Detection (not correction): after each rembg run we measure the
-- non-transparent bounding box of the cutout as a fraction of the
-- full canvas (see lib/rembg/bbox.ts). When it's below the threshold
-- (BBOX_WARN_THRESHOLD = 0.5 in app code) we tag the row so the
-- operator gets a soft, non-blocking warning on the edit page.
--
-- Two columns:
--   • bbox_ratio numeric — non-transparent bbox area / canvas area,
--     range [0,1]. NULL = never measured (legacy rows + rows that
--     never went through rembg, e.g. image_kind='real_photo'
--     references).
--   • cutout_warning text — categorized warning. Today the only value
--     is 'bbox_too_small'; NULL = no warning. Kept as free text (not
--     an enum) so future detectors (e.g. 'low_alpha_coverage') don't
--     need a constraint migration.
--
-- Both nullable, no backfill — existing cutouts simply show no
-- warning until their next rembg run re-measures them.

alter table public.product_images
  add column if not exists bbox_ratio     numeric,
  add column if not exists cutout_warning text;

notify pgrst, 'reload schema';
