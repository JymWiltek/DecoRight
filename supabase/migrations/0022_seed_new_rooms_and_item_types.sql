-- Seed 4 new rooms + 6 new item_types (no subtypes).
--
-- Phase-2 catalog expansion. Pure data migration — schema unchanged.
-- Sectioned for revertability; if any FK fails the whole migration
-- rolls back.
--
--
-- 1) Rooms
--
-- cover_url = NULL on all four → FE falls back to the typographic
-- tile (RoomCard pattern), same as the 6 legacy quasi-rooms. Real
-- photographs come in a follow-up commit alongside seed-room-covers.
-- Sort order 12–15 slots them after the legacy quasi-rooms (6–11)
-- but before Balcony (100). Visual order on home page becomes:
--   covered rooms (1–5) → quasi-rooms (6–11) → new rooms (12–15)
--   → Balcony (100). Acceptable for now; design-promotion order
--   shifts when covers are added.
--
-- ms tone: matches our existing pattern of borrowed-then-localized
-- terms (e.g. "Sofa" / "Tilam" rather than deeper-Malay equivalents).
-- "Pejabat" for office, "Bilik Kanak-kanak" for children's room
-- (literally "room of children", standard ms-Malaysia phrasing),
-- "Bilik Dobi" for laundry (dobi being the borrowed loanword for
-- "laundry"), and "Luar Rumah" for outdoor (literally "outside the
-- house" — the natural ms phrasing; "Luar" alone means "outside").

insert into rooms (slug, label_en, label_zh, label_ms, sort_order, cover_url) values
  ('office',         'Office',           '办公室',   'Pejabat',           12, null),
  ('children_room',  'Children''s Room', '儿童房',  'Bilik Kanak-kanak', 13, null),
  ('laundry',        'Laundry',          '洗衣房',  'Bilik Dobi',        14, null),
  ('outdoor',        'Outdoor',          '户外',    'Luar Rumah',        15, null);


-- 2) Item types
--
-- All six are subtype-free (matches Door / Wall Art / Rug pattern —
-- attribute_schema '{}'::jsonb leaves the per-type attribute facet
-- empty until product attributes are profiled).
--
-- Sort orders use the existing band convention loosely:
--   • 18 — armchair, slots after sofa (15) since it's a living seat.
--   • 22 — bookshelf, between coffee_table (20) and tv_cabinet (30);
--     bookshelves are first-class living-room furniture.
--   • 78 — wall_sconce, between table_lamp (75) and wall_art (80);
--     fits the lighting band.
--   • 215 — desk, after nightstand (210), before wardrobe (220).
--   • 217 — office_chair, paired with desk (1-unit gap; admin can
--     resort if needed).
--   • 225 — dresser, between wardrobe (220) and vanity (230).
--
-- ms tone:
--   • "Kerusi Berlengan" — armchair (literally "armed chair").
--   • "Meja Tulis" — desk (literally "writing table"; the natural
--     ms term, distinct from "Meja" which is a generic table).
--   • "Kerusi Pejabat" — office chair (matches the new room slug
--     'pejabat').
--   • "Rak Buku" — bookshelf (literally "book rack"). "Rak" is the
--     same loanword family as "Rak TV" (tv_cabinet's existing ms).
--   • "Almari Laci" — dresser (literally "drawered cabinet"; matches
--     existing "Almari" pattern from wardrobe).
--   • "Lampu Dinding" — wall sconce (literally "wall lamp"; mirrors
--     the construction of "Lampu Lantai" / "Lampu Meja").

insert into item_types (slug, label_en, label_zh, label_ms, sort_order, attribute_schema) values
  ('armchair',     'Armchair',     '扶手椅', 'Kerusi Berlengan', 18,  '{}'::jsonb),
  ('bookshelf',    'Bookshelf',    '书架',   'Rak Buku',         22,  '{}'::jsonb),
  ('wall_sconce',  'Wall Sconce',  '壁灯',   'Lampu Dinding',    78,  '{}'::jsonb),
  ('desk',         'Desk',         '书桌',   'Meja Tulis',       215, '{}'::jsonb),
  ('office_chair', 'Office Chair', '办公椅', 'Kerusi Pejabat',   217, '{}'::jsonb),
  ('dresser',      'Dresser',      '五斗柜', 'Almari Laci',      225, '{}'::jsonb);


-- 3) Item-type ↔ room mapping (M2M)
--
-- Spec mappings. Wall sconce → "Hallway" in the spec, but DecoRight
-- has no 'hallway' room — the closest concept is 'entrance' (玄关 /
-- Pintu Masuk), which is the hallway-adjacent foyer slot. Mapping
-- Wall Sconce to entrance instead. Flagged for human review in case
-- a separate Hallway room is later carved out.

insert into item_type_rooms (item_type_slug, room_slug, sort_order) values
  -- Armchair → Living Room only (kept tight; could expand to bedroom later).
  ('armchair',     'living_room',  100),
  -- Desk → Office + Bedroom (study nook in master is common).
  ('desk',         'office',       100),
  ('desk',         'bedroom',      100),
  -- Office Chair → Office only.
  ('office_chair', 'office',       100),
  -- Bookshelf → Living Room + Office + Bedroom.
  ('bookshelf',    'living_room',  100),
  ('bookshelf',    'office',       100),
  ('bookshelf',    'bedroom',      100),
  -- Dresser → Bedroom only.
  ('dresser',      'bedroom',      100),
  -- Wall Sconce → Living Room + Bedroom + Bathroom + Entrance
  -- (Entrance substitutes for the spec's "Hallway" — see comment
  -- above).
  ('wall_sconce',  'living_room',  100),
  ('wall_sconce',  'bedroom',      100),
  ('wall_sconce',  'bathroom',     100),
  ('wall_sconce',  'entrance',     100);
