-- ──────────────────────────────────────────────────────────────
-- DecoRight — Phase 1 Step 2 — initial schema
-- Paste this entire file into Supabase SQL Editor and click "Run".
-- Idempotent: safe to re-run (uses IF NOT EXISTS / DROP POLICY IF EXISTS).
-- ──────────────────────────────────────────────────────────────

-- ========== 1. products table ==========

CREATE TABLE IF NOT EXISTS public.products (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- core
  name                        text NOT NULL,
  brand                       text,
  category                    text NOT NULL,
  subcategory                 text,

  -- taxonomy (enums enforced via CHECK; nullable until AI/human fills)
  style                       text,
  primary_color               text,
  material                    text,
  installation                text,
  applicable_space            text[] NOT NULL DEFAULT '{}',

  -- physical
  dimensions_mm               jsonb,
  weight_kg                   numeric CHECK (weight_kg IS NULL OR weight_kg > 0),

  -- commercial
  price_myr                   numeric CHECK (price_myr IS NULL OR price_myr >= 0),
  price_tier                  text,
  color_variants              jsonb NOT NULL DEFAULT '[]'::jsonb,
  purchase_url                text,
  supplier                    text,

  -- media
  description                 text,
  glb_url                     text,
  glb_size_kb                 integer CHECK (glb_size_kb IS NULL OR glb_size_kb > 0),
  thumbnail_url               text,

  -- lifecycle
  status                      text NOT NULL DEFAULT 'draft',
  ai_filled_fields            text[] NOT NULL DEFAULT '{}',
  link_reported_broken_count  integer NOT NULL DEFAULT 0 CHECK (link_reported_broken_count >= 0),

  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  -- enum CHECKs (PROJECT_SPEC §7)
  CONSTRAINT products_category_chk CHECK (
    category IN ('bathroom','kitchen','lighting','furniture','decor')
  ),
  CONSTRAINT products_style_chk CHECK (
    style IS NULL OR style IN (
      'modern','minimalist','scandinavian','japanese','industrial',
      'luxury','vintage','mediterranean','classic'
    )
  ),
  CONSTRAINT products_primary_color_chk CHECK (
    primary_color IS NULL OR primary_color IN (
      'white','black','grey','silver','gold','rose_gold','copper','brass','chrome',
      'wood_light','wood_dark','beige','brown','blue','green'
    )
  ),
  CONSTRAINT products_material_chk CHECK (
    material IS NULL OR material IN (
      'stainless_steel','brass','chrome_plated','ceramic','porcelain','glass',
      'marble','granite','solid_wood','engineered_wood','fabric','leather',
      'plastic','zinc_alloy'
    )
  ),
  CONSTRAINT products_installation_chk CHECK (
    installation IS NULL OR installation IN (
      'wall_mounted','floor_standing','countertop','undermount','freestanding',
      'built_in','ceiling_mounted','pendant'
    )
  ),
  CONSTRAINT products_applicable_space_chk CHECK (
    applicable_space <@ ARRAY[
      'master_bathroom','guest_bathroom','kitchen','living_room','dining_room',
      'master_bedroom','secondary_bedroom','study','balcony','entrance','laundry'
    ]::text[]
  ),
  CONSTRAINT products_price_tier_chk CHECK (
    price_tier IS NULL OR price_tier IN ('economy','mid','premium')
  ),
  CONSTRAINT products_status_chk CHECK (
    status IN ('draft','published','archived','link_broken')
  )
);

-- ========== 2. updated_at trigger ==========

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_set_updated_at ON public.products;
CREATE TRIGGER products_set_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ========== 3. indexes ==========

-- partial index for the hot path: "show published products on home page"
CREATE INDEX IF NOT EXISTS products_published_created_idx
  ON public.products (created_at DESC)
  WHERE status = 'published';

-- common filter columns
CREATE INDEX IF NOT EXISTS products_category_idx      ON public.products (category);
CREATE INDEX IF NOT EXISTS products_style_idx         ON public.products (style);
CREATE INDEX IF NOT EXISTS products_primary_color_idx ON public.products (primary_color);
CREATE INDEX IF NOT EXISTS products_status_idx        ON public.products (status);

-- GIN for applicable_space array containment queries (`@>`, `&&`)
CREATE INDEX IF NOT EXISTS products_applicable_space_gin
  ON public.products USING GIN (applicable_space);

-- ========== 4. Row Level Security ==========

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- anon + authenticated: read only published rows
DROP POLICY IF EXISTS "public read published" ON public.products;
CREATE POLICY "public read published"
  ON public.products
  FOR SELECT
  TO anon, authenticated
  USING (status = 'published');

-- NOTE: service_role bypasses RLS automatically. All admin writes + draft reads
-- must go through the server-side service-role client.

-- ========== 5. storage buckets ==========

-- models bucket: .glb files, 15 MB limit (Phase 1 target 5-8 MB, headroom for edge cases)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'models',
  'models',
  true,
  15728640,
  ARRAY['model/gltf-binary','application/octet-stream']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- thumbnails bucket: .webp, 500 KB limit
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'thumbnails',
  'thumbnails',
  true,
  512000,
  ARRAY['image/webp','image/jpeg','image/png']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- public buckets: public URLs work out-of-the-box, no extra policy needed for reads.
-- Service role bypasses RLS for writes. No upload policy required (uploads happen
-- server-side with service role).
