-- 0014_meshy_phase_a_fields.sql
--
-- Phase A · Milestone 2: prepare the products table for the Meshy
-- image-to-3D pipeline. Milestone 2 is data-layer only — no UI, no
-- Publish-flow rewiring. This migration just makes the columns and
-- constraints exist so Milestone 3 (Publish hookup) has somewhere
-- to write to.
--
-- Why these specific fields, in plain terms:
--   * meshy_status        — where the GLB is in its lifecycle
--                           (pending → generating → succeeded | failed).
--                           A product without a successful GLB cannot
--                           publish (铁律: 没 GLB 不上线).
--   * meshy_task_id       — the ID Meshy's API hands back at task
--                           creation; we poll status with this. Renamed
--                           from the existing meshy_job_id (Meshy's
--                           own docs call it task_id, no reason to
--                           drift from the upstream vocabulary).
--   * meshy_attempts      — Phase A retries up to 3 times on failure;
--                           this column is the counter the worker
--                           checks before giving up.
--   * meshy_error         — last failure reason, surfaced in the
--                           admin so the operator can decide whether
--                           to swap photos and republish.
--   * glb_generated_at    — when Meshy finished OR when an operator
--                           hand-uploaded a GLB. Used by the admin
--                           list to show "fresh / stale" hints later.
--   * glb_source          — provenance: 'meshy' (auto-generated) or
--                           'manual_upload' (operator hand-uploaded
--                           a GLB to replace or seed it). Audit trail
--                           for the "Meshy only runs once at first
--                           publish" rule (Phase A 设计 §流程 B).
--
-- Why text + CHECK and not Postgres ENUM types:
--   The whole codebase uses text + CHECK (see migration 0003 / 0004
--   / 0010). ENUM types are harder to ALTER and don't compose with
--   the schema-introspection tooling we already use. Sticking with
--   the established convention.
--
-- Status-value rename (queued/processing/success → pending/generating/
-- succeeded): Phase A 技术设计 standardised on the new vocabulary
-- (pending/generating/succeeded/failed). The old CHECK is dropped
-- and replaced; safe because every existing row has meshy_status
-- IS NULL — confirmed pre-migration with:
--     select count(*) from products where meshy_status is not null;
--   → 0
--
-- Backfill plan (existing 14 product rows):
--   * 6 rows that already have a glb_url → mark
--       meshy_status   = 'succeeded'
--       glb_source     = 'manual_upload'
--       glb_generated_at = updated_at
--     This includes the 3 seed rows pointing at modelviewer.dev
--     placeholders (treated as manual_upload — operator chose an
--     external URL, equivalent to handing in a GLB) and the 3
--     real bathtub / Auto-QA products with Supabase-hosted GLBs.
--   * 8 rows with glb_url IS NULL → leave status, source, and
--     generated_at all NULL. Marking them 'succeeded' would lie
--     about reality and would conflict with the publish-time check
--     Milestone 3 will add ("must have meshy_status='succeeded'
--     before publishing"); these rows simply haven't gone through
--     the pipeline at all yet.
--
-- Storage decision (Q1 in the pre-flight): no new bucket. The
-- existing public `models` bucket from migration 0003 STEP 9 is
-- kept; Phase 1 already validated 47 MB GLB uploads through it,
-- and src/lib/storage.ts already exposes glbPublicUrl()/
-- createSignedGlbUploadUrl() pointing there. Inventing a parallel
-- `glb` bucket would mean migrating 3 live GLBs and rewriting the
-- helpers for zero functional gain.

begin;

-- ---------------------------------------------------------------
-- 1. Rename meshy_job_id → meshy_task_id
-- ---------------------------------------------------------------
-- The column was added in 0003 STEP 7 and has been NULL on every
-- row since (no Meshy code shipped yet), so this is a pure rename.
alter table public.products
  rename column meshy_job_id to meshy_task_id;

-- ---------------------------------------------------------------
-- 2. Replace the meshy_status CHECK with the new value set
-- ---------------------------------------------------------------
-- Drop the old constraint (queued/processing/success/failed) and
-- add the Phase A one (pending/generating/succeeded/failed). Both
-- still allow NULL — products that never entered the Meshy pipeline
-- have NULL status, which is distinct from 'pending' (= "queued
-- but not yet started").
alter table public.products
  drop constraint if exists products_meshy_status_check;

alter table public.products
  add constraint products_meshy_status_check
  check (
    meshy_status is null
    or meshy_status in ('pending','generating','succeeded','failed')
  );

-- ---------------------------------------------------------------
-- 3. New columns for Phase A
-- ---------------------------------------------------------------
-- meshy_attempts is NOT NULL with default 0 because every row should
-- always have a counter — when the worker reads it, "no row yet"
-- should mean 0 retries, not "unknown". The default backfills all
-- 14 existing rows to 0 in this same statement.
alter table public.products
  add column if not exists meshy_attempts    integer       not null default 0,
  add column if not exists meshy_error       text          null,
  add column if not exists glb_generated_at  timestamptz   null,
  add column if not exists glb_source        text          null;

-- glb_source is nullable: a row with no GLB at all (status NULL)
-- has no meaningful source. Rows that DO have a GLB must declare
-- one of the two known origins; the CHECK enforces that.
alter table public.products
  drop constraint if exists products_glb_source_check;

alter table public.products
  add constraint products_glb_source_check
  check (
    glb_source is null
    or glb_source in ('meshy','manual_upload')
  );

-- ---------------------------------------------------------------
-- 4. Index on meshy_task_id for the polling worker
-- ---------------------------------------------------------------
-- Milestone 3 will run a background loop that reads "all products
-- where meshy_status='generating'" and polls Meshy by task_id. The
-- task_id lookup is one row at a time; an index on meshy_task_id
-- keeps that lookup O(log n) instead of a seq scan as the table
-- grows. Partial: only rows with a non-null task_id need indexing.
create index if not exists idx_products_meshy_task_id
  on public.products (meshy_task_id)
  where meshy_task_id is not null;

-- ---------------------------------------------------------------
-- 5. Backfill the 6 rows that already have a glb_url
-- ---------------------------------------------------------------
-- Why mark them 'succeeded' + 'manual_upload':
--   These rows reached "has a GLB" without ever touching Meshy in
--   our pipeline. From the system's point of view that's identical
--   to "operator hand-uploaded a GLB" — which is the manual_upload
--   provenance Phase A defines. Marking them 'succeeded' lets the
--   future publish gate ("must be meshy_status='succeeded'") accept
--   them as-is without grandfathering exceptions.
--
-- glb_generated_at is set to updated_at because that's the closest
-- proxy we have for "when did this GLB land". For the 3 seed rows
-- that's roughly when the seed script ran; for the 3 real products
-- it's when the operator last saved them.
update public.products
   set meshy_status     = 'succeeded',
       glb_source       = 'manual_upload',
       glb_generated_at = updated_at
 where glb_url is not null
   and meshy_status is null;  -- defensive: don't clobber any state
                              -- that somehow already got set.

-- The 8 rows with glb_url IS NULL are intentionally left untouched.
-- meshy_status, glb_source, glb_generated_at all stay NULL. They
-- are the products Milestone 3's publish flow will actually push
-- through Meshy.

commit;
