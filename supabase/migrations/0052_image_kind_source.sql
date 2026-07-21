-- Who decided this image's kind.
--
-- product_images.image_kind is `not null default 'cutout'`, so every row has a
-- value and there is no way to tell an explicit human decision from the
-- default the upload pipeline happened to leave. The Read-specs pass now
-- classifies the images it is already looking at (product photo vs spec
-- sheet), and it must never overwrite a human's call — so we need to know
-- which is which.
--
--   NULL       — never explicitly decided (legacy rows + pipeline defaults).
--                AI classification MAY write here.
--   'operator' — a human set it. AI never touches these.
--   'ai'       — set by the spec-parse classifier. Re-running may update it.
--
-- Note there is currently no UI for a human to change image_kind at all; this
-- column is what lets one exist later without the classifier trampling it.
alter table public.product_images
  add column if not exists image_kind_source text
    check (image_kind_source in ('operator', 'ai'));

notify pgrst, 'reload schema';
