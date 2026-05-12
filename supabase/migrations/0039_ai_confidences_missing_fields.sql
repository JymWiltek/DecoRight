-- 0039 — Wave 7 AI auto-publish bookkeeping.
--
-- Two new columns on products to support confidence-gated auto-publish
-- from bulkCreateProducts' async tail:
--
--   • ai_confidences jsonb
--     Per-field confidence the V2 parser returned. Shape:
--     { "name": "high", "sku_id": "high", "item_type_slug": "high",
--       "room_slugs": "medium", "style_slugs": "low", ... }
--     Used by the /admin list "Low confidence:" sub-line and by future
--     "operator should verify" filters. Default '{}'::jsonb = "never
--     run AI" (pre-Wave-7 rows + manual creates).
--
--   • missing_fields text[]
--     Fields that remain null after the AI tail tried to fill them
--     (e.g. dimensions when no spec sheet was uploaded; SKU when no
--     printed label was visible). Populated alongside ai_confidences
--     inside bulkCreateProducts so the /admin list can show
--     "Missing: dimensions, weight_kg" without re-deriving from the
--     row. Default ARRAY[]::text[] = "nothing missing tracked yet".
--
-- Both are NOT NULL with safe defaults so a backfill is unnecessary.
-- Existing non-Wave-7 rows render as "—" on the /admin list because
-- both columns are empty.

alter table public.products
  add column if not exists ai_confidences jsonb  not null default '{}'::jsonb,
  add column if not exists missing_fields  text[] not null default array[]::text[];

notify pgrst, 'reload schema';
