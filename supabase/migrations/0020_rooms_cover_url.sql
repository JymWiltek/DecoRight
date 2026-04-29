-- Wave UI · Commit 3: rooms.cover_url for the home-page room grid.
--
-- The redesigned home page shows each Room as an image-led card
-- ("see the kitchen, click the kitchen") instead of the current
-- gradient-text tile. Cover photos live in our `thumbnails` public
-- bucket (already in production, already CDN-cached, already used
-- for product thumbnails) — we point at our own URL so we can swap
-- the source later (Unsplash placeholder → Jym's real photographs)
-- without changing any FE code.
--
-- Why public-readable: the home page is anon-cacheable and the cover
-- images are not sensitive. Bucket already public + RLS clean for
-- the same reason `thumbnails` already serves product thumbnails.
--
-- Why nullable: the current 12 rooms include legacy quasi-rooms
-- (Curtain, Decor, Door, Entrance, Lighting, Walls & Floor) that
-- the Notion-design Section 3 doesn't promote. Those keep cover_url
-- = NULL and the FE falls back to a gradient-text tile (same look
-- as the current CategoryTile). Future Phase 2: shoot real photos
-- and fill the rest.
ALTER TABLE rooms
  ADD COLUMN cover_url text NULL;

COMMENT ON COLUMN rooms.cover_url IS
  'Public URL of a representative photo for this room, served from '
  'our own thumbnails bucket. NULL = fall back to typographic tile. '
  'Populated by scripts/seed-room-covers.ts; replaceable any time.';
