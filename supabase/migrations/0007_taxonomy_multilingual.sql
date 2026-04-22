-- =====================================================================
-- 0007 · multilingual taxonomy labels
--
-- Phase 2 of the i18n refactor: each taxonomy table gains nullable
-- label_en + label_ms columns. label_zh stays NOT NULL as the canonical
-- source — we always have *something* to show, and the runtime falls
-- back to zh when a locale column is null.
--
-- Tables touched: rooms, item_types, item_subtypes, styles, materials,
-- colors. (attribute_schema lives in a JSONB blob on item_types and is
-- not handled here — Phase 2 only covers the row-level labels that
-- render as pills/chips in the public catalog.)
--
-- Freshly-added rows start with label_en = label_ms = null. The admin
-- "Auto-translate missing" button (server action using Claude Sonnet
-- 4.5) populates them in a batch. Until then the UI falls back to
-- label_zh for that row, so English/Malay users see Chinese text for
-- unmapped rows — a visible prompt to translate, not a silent dropout.
-- =====================================================================

alter table public.rooms
  add column if not exists label_en text,
  add column if not exists label_ms text;

alter table public.item_types
  add column if not exists label_en text,
  add column if not exists label_ms text;

alter table public.item_subtypes
  add column if not exists label_en text,
  add column if not exists label_ms text;

alter table public.styles
  add column if not exists label_en text,
  add column if not exists label_ms text;

alter table public.materials
  add column if not exists label_en text,
  add column if not exists label_ms text;

alter table public.colors
  add column if not exists label_en text,
  add column if not exists label_ms text;

notify pgrst, 'reload schema';
