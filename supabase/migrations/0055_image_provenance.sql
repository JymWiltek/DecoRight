-- Per-image PROVENANCE — where an image came from, for the consumer-facing
-- "📷 real photo" badge and honest sourcing. Three-layer auto+manual pipeline.
--
-- This is ORTHOGONAL to image_kind (mig 0034: cutout / real_photo / spec_sheet,
-- the rembg-pipeline classifier). provenance is a display/sourcing label; the
-- 'real_photo' value here happens to share a word with image_kind but is a
-- different axis and set independently.
--
--   provenance:
--     NULL           — unclassified (the layer-2 AI candidate pool).
--     'ai_scene'     — an AI-generated scene image (deterministic: /scene- URL).
--     'product_shot' — a plain white/studio product cutout (deterministic:
--                      isWhiteBackgroundImage), OR the layer-2 AI fallback.
--     'real_photo'   — a real photograph (layer-2 AI, or a human's call). Drives
--                      the storefront "实拍图 / Real photo / Foto sebenar" badge.
--
--   provenance_by — WHO decided provenance, so an auto pass never clobbers a
--                   human (mirrors image_kind_source's operator/ai rule):
--     NULL         — undecided.
--     'auto_rule'  — layer 1, deterministic (URL / white-bg). Zero AI.
--     'auto_ai'    — layer 2, the batch vision classifier. Writes only where
--                    provenance was still unclassified; never over 'manual'.
--     'manual'     — layer 3, a human clicked to set it. Highest authority —
--                    no automatic layer may overwrite it.
--
-- No backfill: every existing row is NULL/NULL (unclassified) until the layer-1
-- pass and the operator-triggered layer-2 run label them. NOT wired into any
-- publish gate — pure annotation + display.
alter table public.product_images
  add column if not exists provenance text
    check (provenance in ('ai_scene', 'product_shot', 'real_photo')),
  add column if not exists provenance_by text
    check (provenance_by in ('auto_rule', 'auto_ai', 'manual'));

notify pgrst, 'reload schema';
