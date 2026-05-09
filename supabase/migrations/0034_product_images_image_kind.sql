-- 0034 — Add image_kind to product_images.
--
-- Why: the table started life with a single purpose — raw uploads
-- bound for the rembg cutout pipeline. We're now adding two more
-- categories of images that share the same storage bucket + foreign
-- key but have different processing rules:
--
--   • cutout       — existing behavior; goes through rembg → admin
--                    review → approved/rejected. The styled-thumbnail
--                    slide on the storefront comes from these.
--   • real_photo   — operator-uploaded shots of the real product (Wave
--                    4). NEVER goes through rembg. Renders as-is in
--                    a dedicated carousel below the main gallery.
--   • spec_sheet   — brand spec PDFs / images uploaded for Wave 3's
--                    GPT-4o vision parser. Private, never shown on
--                    the storefront. Stored alongside cutouts so a
--                    single product_id → image_id key continues to
--                    cover all artifacts.
--
-- Default 'cutout' + NOT NULL: existing rows pre-mig-0034 keep the
-- legacy behavior automatically. New inserts must declare a kind.
-- CHECK constraint pins the value space; admin code will enforce
-- additionally at the type level (TS union).
--
-- Index: the rembg processing scan and the storefront real_photo
-- fetch both filter on (product_id, image_kind, state). Existing
-- partial index on (product_id, state) does most of the work; we
-- add a small composite index to keep the new real_photo lookup
-- O(log n) without scanning rejected/failed rows.

alter table public.product_images
  add column if not exists image_kind text not null default 'cutout';

alter table public.product_images
  drop constraint if exists product_images_image_kind_check;

alter table public.product_images
  add constraint product_images_image_kind_check
  check (image_kind in ('cutout', 'real_photo', 'spec_sheet'));

create index if not exists idx_product_images_kind
  on public.product_images (product_id, image_kind, state);
