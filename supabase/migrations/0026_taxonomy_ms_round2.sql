-- Wave SEO commit 4 — round-2 ms standardization (audit-driven).
--
-- Each UPDATE is guarded by `AND label_ms = '<old>'` so the migration
-- is idempotent and a re-run on already-fixed rows is a no-op rather
-- than overwriting a hand-edit. 14 rows across 4 tables; the 5 🟢
-- "intentional/keep" rows from the audit are intentionally NOT
-- touched (sofa, sensor, whirlpool, flooring, granite).

-- ── styles (3) ────────────────────────────────────────────────────
-- vintage: collided with classic ('Klasik'). 'Vintaj' is the BM
-- transliteration commonly used in Malaysian retail.
update styles set label_ms = 'Vintaj'
 where slug = 'vintage' and label_ms = 'Klasik';

-- mediterranean: typo (double r). Standard BM is single-r 'Mediterania'.
update styles set label_ms = 'Mediterania'
 where slug = 'mediterranean' and label_ms = 'Mediterrania';

-- scandinavian: anglicized -ian suffix. Standard BM drops it.
update styles set label_ms = 'Skandinavia'
 where slug = 'scandinavian' and label_ms = 'Skandinavian';

-- ── item_types (7) ────────────────────────────────────────────────
-- faucet: 'Paip' = pipe (the tube). IKEA Malaysia uses 'Pili' for
-- tap. 'Pili Air' is unambiguous.
update item_types set label_ms = 'Pili Air'
 where slug = 'faucet' and label_ms = 'Paip';

-- rug: 'Tikar' = woven floor mat (traditional). Rug = 'Permaidani'.
update item_types set label_ms = 'Permaidani'
 where slug = 'rug' and label_ms = 'Tikar';

-- wardrobe: 'Almari' alone is too generic (cabinet). Wardrobe is
-- specifically 'Almari Pakaian'. Disambiguates from dresser
-- ('Almari Laci') and shoe_cabinet ('Kabinet Kasut').
update item_types set label_ms = 'Almari Pakaian'
 where slug = 'wardrobe' and label_ms = 'Almari';

-- range_hood: mixed English ('Hood'). BM transliteration is 'Hud'.
update item_types set label_ms = 'Hud Dapur'
 where slug = 'range_hood' and label_ms = 'Hood Dapur';

-- tv_cabinet: 'Rak' = shelf, but kitchen_cabinet/shoe_cabinet use
-- 'Kabinet'. Make naming consistent across cabinet item_types.
update item_types set label_ms = 'Kabinet TV'
 where slug = 'tv_cabinet' and label_ms = 'Rak TV';

-- nightstand: 'Meja Sebelah Katil' is verbose. IKEA Malaysia uses
-- 'Meja Sisi Katil'.
update item_types set label_ms = 'Meja Sisi Katil'
 where slug = 'nightstand' and label_ms = 'Meja Sebelah Katil';

-- sideboard: 'Meja Sisi' = side table — overloaded with the
-- nightstand concept. Sideboard is a buffet/dining storage cabinet,
-- = 'Almari Hidangan'.
update item_types set label_ms = 'Almari Hidangan'
 where slug = 'sideboard' and label_ms = 'Meja Sisi';

-- ── materials (1) ─────────────────────────────────────────────────
-- engineered_wood: 'Rekabentuk' = design, not engineered. Real term
-- is 'Kayu Komposit' (composite wood) — what local hardware lists
-- engineered wood as.
update materials set label_ms = 'Kayu Komposit'
 where slug = 'engineered_wood' and label_ms = 'Kayu Rekabentuk';

-- ── item_subtypes (4) ─────────────────────────────────────────────
-- rectangular_dining_table: WRONG MEANING. 'Empat Segi' = square,
-- NOT rectangle. 'Segi Empat Panjang' = rectangle in BM.
update item_subtypes set label_ms = 'Meja Makan Segi Empat Panjang'
 where slug = 'rectangular_dining_table' and label_ms = 'Meja Makan Empat Segi';

-- Mirror subtypes (decor / full_body / lighted): the BM had a
-- redundant 'Cermin' prefix because these are mirror-only subtypes;
-- the EN doesn't repeat 'Mirror'. Strip the prefix to match the EN
-- pattern. (Direction B from the audit — keep label_en as-is.)
update item_subtypes set label_ms = 'Hiasan'
 where slug = 'decor' and label_ms = 'Cermin Hiasan';

update item_subtypes set label_ms = 'Badan Penuh'
 where slug = 'full_body' and label_ms = 'Cermin Badan Penuh';

update item_subtypes set label_ms = 'Bercahaya'
 where slug = 'lighted' and label_ms = 'Cermin Bercahaya';
