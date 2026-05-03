-- =====================================================================
-- 0027 · product_images.skip_cutout (audit flag)
--
-- Skip-cutout UX (Wave B): operator clicks "Skip — already clean" on a
-- raw image whose photo doesn't need background removal (clean white
-- backdrop, reflective/wood-grain textures rembg destroys, etc). The
-- server action copies the raw bytes from the private raw-images
-- bucket into the public cutouts bucket, sets cutout_image_url to the
-- public URL, and lands the row at state='cutout_approved' — same
-- terminal state a successful rembg run produces.
--
-- skip_cutout is a PURE AUDIT FLAG. It does NOT participate in any
-- gate, RLS policy, trigger, or storefront query. We chose this shape
-- (vs. extending checkPublishGates with a separate skip count) so the
-- existing pipeline — sync_primary_thumbnail trigger, the public-read
-- RLS on state='cutout_approved', loadPublishGateFacts, and the
-- /product/[id] gallery query — keeps working unchanged. The flag
-- only powers:
--   • a "skipped" badge on the admin ImageCard
--   • cost reporting (skip_cutout=true → $0 spend, distinguishable
--     from "rembg attempts cost rolled up")
--
-- Default false: every existing row was either rembg'd or never
-- attempted; none of them are "skipped". Backfilling NULL → false
-- isn't needed because of `not null default false`.
-- =====================================================================

alter table public.product_images
  add column skip_cutout boolean not null default false;

comment on column public.product_images.skip_cutout is
  'Audit flag: operator chose "image is clean, skip background removal" on the admin workbench. The row''s cutout_image_url then points at a copy of the raw bytes in the public cutouts bucket. Pure audit — does not gate publish, RLS, or any query.';

notify pgrst, 'reload schema';
