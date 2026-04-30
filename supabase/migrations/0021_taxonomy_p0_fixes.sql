-- P0 taxonomy data fixes + Mirror three-way merge.
--
-- Three independent fixes that are all data-only (no DDL). Bundling
-- them in one migration because they all share the same blast-radius
-- (taxonomy cache invalidation) and a single revert restores the
-- prior state cleanly. Each block is annotated with what was wrong
-- and why we trust the fix.
--
--
-- 1) Bathroom Vanity ms label
--
-- Was: 'Meja Dapur' — that literally means "kitchen counter / kitchen
-- table" in Malay. A Malay-speaking shopper filtering by Bathroom
-- Vanity was being shown content labeled as kitchen furniture, which
-- is a P0 trust bug, not a typo. Correct term is 'Vaniti Bilik Mandi'
-- (vanity-bathroom), matching how local plumbing and bathroom suppliers
-- list the SKU. Tone matches our other ms labels which prefer the
-- borrowed-then-localized form (e.g. "Sofa", "Tilam", "Kabinet Dapur"),
-- not the deeply-Malay "Almari Solek Bilik Mandi".

update item_types
   set label_ms = 'Vaniti Bilik Mandi'
 where slug = 'bathroom_vanity'
   and label_ms = 'Meja Dapur';


-- 2) Porcelain ms label
--
-- Was: 'Seramik' — same as Ceramic. That collapses two distinct
-- materials into one filter chip in ms, breaking the materials
-- facet entirely for Malay users. Porcelain in ms is 'Porselin'
-- (the standard borrowed term used in DIY / hardware shops); 'Seramik'
-- stays correct for Ceramic. label_zh already disambiguates (陶瓷 vs.
-- 瓷). label_en already disambiguates. ms was the only broken locale.

update materials
   set label_ms = 'Porselin'
 where slug = 'porcelain'
   and label_ms = 'Seramik';


-- 3) Mirror three-way merge
--
-- Pre-state (verified 2026-04-30):
--   • item_types.mirror             — canonical, has subtypes
--                                       (full_body / decor / lighted)
--                                       and rooms (bedroom, bathroom,
--                                       decor, entrance) already.
--   • item_types.bathroom_mirror    — redundant (0 products linked).
--   • item_types.full_body_mirror   — redundant (0 products linked).
--
-- The redundancy was a Wave 1 oversight: a flat-tax era kept three
-- separate Mirror buckets so the FE could show "Bathroom Mirror" /
-- "Full Body Mirror" tiles directly. Three-dim taxonomy (mig 0013)
-- introduced subtypes for that purpose — which means the dedicated
-- item_types are now dead weight that splits filter UX and pollutes
-- the admin item-type dropdown.
--
-- Because no products reference either redundant slug, the merge is
-- purely a metadata cleanup. We do NOT touch the one product on
-- item_types.mirror (subtype='lighted', rooms=[bathroom,bedroom]).
--
-- Order matters: drop item_type_rooms FK rows first, then the
-- item_types rows themselves (FK on item_subtypes is also clean —
-- bathroom_mirror / full_body_mirror have no rows in item_subtypes).

-- 3a) Defensive: if any product was added since 2026-04-30 with a
--     redundant slug, route it onto the canonical 'mirror' before
--     the FK rows go away. NULL subtype here means "admin can fill
--     this in" — the spec is explicit not to guess.

update products
   set item_type    = 'mirror',
       subtype_slug = case
                        -- Bathroom-mirror products are usually wall-mount
                        -- decor mirrors; without inspection we leave it
                        -- NULL for human review.
                        when item_type = 'bathroom_mirror'  then null
                        -- Full-body mirrors map cleanly to the existing
                        -- 'full_body' subtype.
                        when item_type = 'full_body_mirror' then 'full_body'
                     end,
       -- Bathroom Mirror implies bathroom; Full Body Mirror keeps
       -- whatever rooms were already there (M2M may already include
       -- bedroom/entrance/etc.).
       room_slugs = case
                       when item_type = 'bathroom_mirror'
                         and not ('bathroom' = any(room_slugs))
                       then array_append(room_slugs, 'bathroom')
                       else room_slugs
                    end
 where item_type in ('bathroom_mirror', 'full_body_mirror');

-- 3b) Drop FK rows pointing at the soon-to-be-deleted item_types.

delete from item_type_rooms
 where item_type_slug in ('bathroom_mirror', 'full_body_mirror');

-- 3c) Drop the redundant item_types themselves.

delete from item_types
 where slug in ('bathroom_mirror', 'full_body_mirror');
