-- Reorder rooms.sort_order — real rooms first, quasi-rooms last.
--
-- Why now:
--   The FE home grid (Wave UI Section 3) renders all rooms in the
--   order taxonomy.rooms returns them. Existing sort_order had real
--   covered rooms (1–5), legacy quasi-rooms (6–11), new uncovered
--   rooms (12–15), and Balcony parked at 100 — visually weird since
--   shoppers saw "Bathroom → ... → Curtain → Door → ... → Office →
--   Outdoor → ... → Balcony". Real living rooms got buried behind
--   storefront-internal categories like "Curtain" and "Door".
--
-- New layout — physical rooms 1–11, storefront-internal categories
-- (rendered in the typographic style without covers) bumped to 20+
-- with intentional gaps so future rooms can slot in without
-- another mass renumber:
--
--   1   bathroom        (covered)
--   2   bedroom         (covered)
--   3   kitchen         (covered)
--   4   living_room     (covered)
--   5   dining_room     (covered)
--   6   office          (new, no cover yet)
--   7   children_room   (new, no cover yet)
--   8   laundry         (new, no cover yet)
--   9   outdoor         (new, no cover yet)
--   10  balcony         (no cover yet — was at 100, pulled in)
--   11  entrance        (foyer / hallway-adjacent — real space)
--
--   20  curtain         (storefront-internal category)
--   21  decor
--   22  door
--   23  lighting
--   24  walls_floor
--
-- Once cover_url lands for the 6 newly-promoted real rooms (office,
-- children_room, laundry, outdoor, balcony, entrance), the
-- typographic fallback drops out and the home grid becomes a clean
-- 6-cover-rooms-then-5-quasi-rooms layout.

update rooms set sort_order = 1  where slug = 'bathroom';
update rooms set sort_order = 2  where slug = 'bedroom';
update rooms set sort_order = 3  where slug = 'kitchen';
update rooms set sort_order = 4  where slug = 'living_room';
update rooms set sort_order = 5  where slug = 'dining_room';

update rooms set sort_order = 6  where slug = 'office';
update rooms set sort_order = 7  where slug = 'children_room';
update rooms set sort_order = 8  where slug = 'laundry';
update rooms set sort_order = 9  where slug = 'outdoor';
update rooms set sort_order = 10 where slug = 'balcony';
update rooms set sort_order = 11 where slug = 'entrance';

update rooms set sort_order = 20 where slug = 'curtain';
update rooms set sort_order = 21 where slug = 'decor';
update rooms set sort_order = 22 where slug = 'door';
update rooms set sort_order = 23 where slug = 'lighting';
update rooms set sort_order = 24 where slug = 'walls_floor';
