-- Pre-existing ms-translation hotfixes (4 rows).
--
-- Each fix was caught during Wave verification but is unrelated to
-- the Wave UI scope, so they got collected into one revertable
-- migration. Pure data — no DDL.
--
--
-- 1) Showerhead — strip leading whitespace.
--
-- Was: ' Kepala Pancuran' (extra space at byte 0). Visible in admin
-- dropdowns and FE filter chips as a one-pixel left indent vs. the
-- other ms labels. Likely a copy-paste artifact from when the row
-- was seeded.

update item_types
   set label_ms = 'Kepala Pancuran'
 where slug = 'showerhead'
   and label_ms = ' Kepala Pancuran';


-- 2) Brass ms — 'Bram' is not standard ms-Malaysia.
--
-- Was: 'Bram' — looks like an old-Indonesian / colloquial form. The
-- standard ms-Malaysia term used in hardware listings is
-- 'Tembaga Kuning' (literally "yellow copper"), which mirrors how
-- Malay-speakers actually shop for brass fittings.

update materials
   set label_ms = 'Tembaga Kuning'
 where slug = 'brass'
   and label_ms = 'Bram';


-- 3) Chrome Plated ms — 'Diperbuat Padu Chrome' is broken Malay.
--
-- Was: 'Diperbuat Padu Chrome' (literally "made-solid-Chrome", which
-- isn't a phrase any Malay speaker would write). The correct
-- chrome-plated descriptor is 'Bersalut Krom' — 'bersalut' = coated,
-- 'krom' = chrome, matches how Malaysian plumbing / kitchen catalogs
-- label chrome-plated taps and faucets.

update materials
   set label_ms = 'Bersalut Krom'
 where slug = 'chrome_plated'
   and label_ms = 'Diperbuat Padu Chrome';


-- 4) Cooktop ms — disambiguate from the Kitchen room slug.
--
-- Was: 'Dapur'. In ms 'Dapur' generically means "kitchen", which is
-- ALSO the ms label of the rooms.kitchen row. So a Malay user
-- browsing /room/kitchen saw a "Dapur" tile inside a "Dapur" room —
-- ambiguous. 'Dapur Memasak' (literally "cooking stove") is the
-- more specific Malaysian retail term and disambiguates cleanly:
-- Kitchen (the room) stays 'Dapur'; the appliance becomes
-- 'Dapur Memasak'.
--
-- Generic 'Dapur' is what local retailers (Dapurware, etc.) and
-- IKEA Malaysia use loosely; we add the qualifier because of the
-- room-name collision specific to our taxonomy.

update item_types
   set label_ms = 'Dapur Memasak'
 where slug = 'cooktop'
   and label_ms = 'Dapur';
