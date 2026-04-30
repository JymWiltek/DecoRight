-- Seed Tropical style + Rattan / Bamboo materials.
--
-- Locale-aware style/material expansion for the SEA market. Pure
-- inserts — schema unchanged.
--
--
-- 1) Tropical style
--
-- Common in Malaysia/Indonesia interior catalogs (resort vibes,
-- rattan + greenery + woven textures). Distinct enough from
-- 'mediterranean' (which we already have) and 'scandinavian' that
-- it deserves its own filter chip rather than a tag.
--
-- ms: 'Tropika' — the borrowed-then-localized form, consistent with
-- our other style ms labels ("Moden", "Industri", "Mediterrania").
-- We deliberately do NOT add "Peranakan" — that's a culturally
-- specific style with strong opinions about how it's labeled and
-- needs separate research before shipping (out of scope this batch).

insert into styles (slug, label_en, label_zh, label_ms, sort_order) values
  ('tropical', 'Tropical', '热带', 'Tropika', 100);


-- 2) Rattan + Bamboo materials
--
-- Both are very common in Malaysian furniture and outdoor decor
-- and pair naturally with the new Tropical style. We treat them as
-- separate materials (not subtypes of Solid Wood) because filter
-- intent differs: a shopper looking for "rattan chair" expects a
-- distinct visual material, not a wood variant.
--
-- ms tone:
--   • 'Rotan' is the canonical Malay term for rattan (and is, in
--     fact, the etymological source of the English word). NOT a
--     borrowed-anglicized form — this is the natural local term.
--   • 'Buluh' is canonical Malay for bamboo. Same reasoning: this
--     is the standard ms term used in furniture/handicraft listings
--     across Malaysia/Indonesia.
--
-- Sort orders: 150 / 160 — slot at the end of the existing material
-- list (the last existing material is 'zinc_alloy' at 140).

insert into materials (slug, label_en, label_zh, label_ms, sort_order) values
  ('rattan', 'Rattan', '藤', 'Rotan', 150),
  ('bamboo', 'Bamboo', '竹', 'Buluh', 160);
