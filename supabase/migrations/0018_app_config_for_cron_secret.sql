-- 0018_app_config_for_cron_secret.sql
--
-- Phase A · Milestone 3 · post-Commit-7 hotfix.
--
-- The original Commit 6 design stored CRON_SECRET in a Postgres
-- custom GUC (`app.cron_secret`) set via `ALTER DATABASE postgres
-- SET ...`. That worked great in our local-dev mental model; it
-- fell over in Supabase's managed Postgres because:
--
--   - `ALTER DATABASE ... SET app.<custom>` requires either
--     superuser privileges (Supabase doesn't grant this to
--     service_role) or explicit registration of the custom GUC
--     class (no public hook for that on managed Postgres).
--   - Even the `postgres` role available in Dashboard SQL Editor
--     hit `permission denied to set parameter "app.cron_secret"`.
--   - PostgreSQL helpfully wrote the entire failed `ALTER DATABASE
--     ... SET app.cron_secret = '<value>'` statement into the
--     error message, leaking two would-be secrets in the process.
--     (Both leaked values were never actually persisted because
--     the ALTER itself failed mid-statement, but the leak made
--     them invalid anyway.)
--
-- Pivot: store the cron-side copy of CRON_SECRET in a regular
-- table that the cron job's net.http_post(...) reads on every
-- tick. service_role can INSERT into a regular table; cron can
-- SELECT from it. No GUC, no superuser, no leak surface.
--
-- ---------------------------------------------------------------
-- Why a private schema, not public
-- ---------------------------------------------------------------
-- Supabase's PostgREST instance exposes the `public` schema as a
-- REST API by default (every table → /rest/v1/<table>). The anon
-- key in the front-end bundle is enough to read those tables
-- unless RLS blocks it. So putting `_app_config` in `public` would
-- mean a publicly-fetchable cron secret, which is dramatically
-- worse than the GUC approach we abandoned.
--
-- We instead create a `private` schema. PostgREST's exposure list
-- defaults to ['public'] only — non-public schemas are invisible
-- to the REST API regardless of grants. Belt-and-braces, we also
-- revoke all from anon + authenticated on both the schema and the
-- table.
--
-- ---------------------------------------------------------------
-- Why coalesce(..., '') in the cron job's header
-- ---------------------------------------------------------------
-- If the operator applies this migration but hasn't run the
-- INSERT yet (the dashboard-paste step), the subquery returns
-- NULL. jsonb_build_object('X-Cron-Secret', NULL, ...) would emit
-- a JSON null, which pg_net might pass as the literal string
-- "null" or refuse to send. Either way the edge function would
-- 401 (presented !== CRON_SECRET), but the failure mode is messy
-- to debug.
--
-- coalesce(..., '') makes the header explicitly empty when the
-- table row is missing. Edge function returns a clean 401 (empty
-- string !== the configured CRON_SECRET). Fail-closed, easy to
-- diagnose ("oh, I forgot to INSERT").
--
-- ---------------------------------------------------------------
-- Idempotency
-- ---------------------------------------------------------------
-- All three pieces are idempotent:
--   - `create schema if not exists`
--   - `create table if not exists`
--   - `cron.schedule(jobname, ...)` overwrites by jobname (same
--     idempotency contract as 0017's initial schedule).
--
-- Re-applying this migration is safe and a no-op for existing
-- data (existing _app_config rows are not touched).
--
-- ---------------------------------------------------------------
-- Operator step (one-time, NOT in this migration)
-- ---------------------------------------------------------------
-- After this migration applies, the cron job's header lookup
-- returns '' (no row in _app_config yet) and edge function ticks
-- 401. To activate:
--
--   -- In Dashboard SQL Editor (runs as authenticated session):
--   insert into private._app_config (key, value)
--   values ('cron_secret', '<a 32+ char random string>')
--   on conflict (key) do update
--     set value = excluded.value, updated_at = now();
--
--   -- Then in Dashboard → Project Settings → Edge Functions →
--   -- Secrets, add CRON_SECRET with the same value.
--
-- The two values must match. Rotation is the same INSERT (with
-- ON CONFLICT it overwrites) plus updating the Edge Function
-- secret in the dashboard.
--
-- DEPLOY.md (Commit 7) still describes the abandoned GUC path —
-- a follow-up commit will rewrite Step 4 to reflect this
-- migration's approach. Tracked separately to keep this hotfix
-- focused on the unblocking schema change.

begin;

-- 1. Private schema for internal runtime config — invisible to
--    PostgREST, blocked from anon + authenticated belt-and-braces.
create schema if not exists private;

revoke all on schema private from anon, authenticated;

-- 2. Tiny key/value table. Held to one purpose for now (cron
--    secret), but the schema deliberately allows future runtime-
--    injected config to land here without another migration.
create table if not exists private._app_config (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

revoke all on private._app_config from anon, authenticated;

-- 3. Re-schedule the cron job. Same name as 0017, so this just
--    overwrites the existing row in cron.job.
select cron.schedule(
  'poll-meshy',
  '* * * * *',
  $cron$
  select net.http_post(
    url := 'https://mooggzqjybwuprrsgnny.supabase.co/functions/v1/poll-meshy',
    headers := jsonb_build_object(
      'X-Cron-Secret',
      coalesce(
        (select value from private._app_config where key = 'cron_secret'),
        ''
      ),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $cron$
);

commit;
