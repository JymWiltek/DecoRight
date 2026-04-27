-- Phase 1 收尾 P0-2: rembg failure visibility.
--
-- Today the UI reads `state` to decide what to render. That column
-- has 4 distinct meanings smashed into "raw":
--   1) actively running rembg
--   2) saved-as-draft, never tried
--   3) no provider configured (pipeline returned without writing)
--   4) errored before the failure-write completed
-- ...and "cutout_failed" can mean quota / provider down / bytes too
-- big / generic Replicate 5xx, all looking identical to the operator.
--
-- This column captures *why* the most recent attempt failed so the UI
-- can render a specific, actionable sentence ("Provider not configured.
-- Check Vercel env vars.") instead of a generic "Failed". Set whenever
-- the pipeline writes state='cutout_failed'; cleared (NULL) on retry
-- success.
--
-- The CHECK constraint pins the vocabulary so a stale UI never gets a
-- string it can't render. Add new categories with a follow-up
-- migration; never push raw error.message values into this column.
ALTER TABLE product_images
  ADD COLUMN last_error_kind text NULL
    CHECK (
      last_error_kind IS NULL
      OR last_error_kind IN (
        'no_provider',
        'quota_exhausted',
        'provider_error',
        'image_too_large'
      )
    );

COMMENT ON COLUMN product_images.last_error_kind IS
  'Reason for the most recent rembg failure. Populated by '
  'src/lib/rembg/pipeline.ts when state transitions to cutout_failed. '
  'NULL on success or on rows that have never been attempted. '
  'Vocabulary is closed; expand via migration only.';

-- Backfill: 2 known cutout_failed rows from 2026-04-24 with NULL
-- rembg_provider/cost. The failure happened before the provider
-- could be recorded — most likely the no_provider path (which today
-- doesn't write any DB state). After this commit lands, no_provider
-- will write cutout_failed + last_error_kind='no_provider'. Tag those
-- two retroactively so the operator's view is consistent. Anything
-- else with a non-null provider that got refunded was a real
-- provider-side error → 'provider_error'.
UPDATE product_images
   SET last_error_kind = 'no_provider'
 WHERE state = 'cutout_failed'
   AND rembg_provider IS NULL
   AND last_error_kind IS NULL;
