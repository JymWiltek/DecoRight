-- 0017_schedule_poll_meshy_cron.sql
--
-- Phase A · Milestone 3 · Commit 6 of 7.
--
-- Schedules the every-minute cron job that drives the Meshy
-- polling worker (the edge function landed in Commit 5). This
-- migration is the *scheduler*; it does not deploy the function
-- itself. See "Operational state after this migration" below
-- for what is and isn't live after `supabase db push`.
--
-- ---------------------------------------------------------------
-- Why a cron job at all
-- ---------------------------------------------------------------
-- The Publish flow kicks off a Meshy task and returns immediately
-- — the row sits in meshy_status='generating' until something
-- comes back to mark it 'succeeded' or 'failed'. The original
-- design dilemma (Commit 4 header) ruled out client-side polling
-- because the operator might close the browser. So a server-side
-- timer has to:
--
--   (a) walk every product where meshy_status='generating'
--   (b) GET https://api.meshy.ai/.../<task_id>
--   (c) on SUCCEEDED → download GLB, upload to Storage, flip
--       status to 'published'
--   (d) on FAILED/CANCELED → stamp meshy_error
--
-- Steps (b)-(d) are all in the edge function (Commit 5's
-- worker.ts). This migration is just the timer that fires (a)
-- by HTTP-POSTing the function on each tick.
--
-- ---------------------------------------------------------------
-- Why every minute (`* * * * *`)
-- ---------------------------------------------------------------
-- Meshy multi-image-to-3D tasks typically take 60-180 seconds.
-- A 60-second cadence means the worst-case wait between Meshy
-- finishing and the operator seeing the row flip to 'published'
-- is ~60s — well inside the post-Publish "watching the banner"
-- window the UI is built around (MeshyStatusBanner polls the DB
-- every 5s, so once the cron writes the success, the banner sees
-- it on its next tick).
--
-- We could go faster (every 30s requires a workaround since
-- pg_cron's minimum granularity is 1 minute on the standard
-- expression — would need two staggered jobs). Not worth it for
-- Phase A: ~60s p99 latency at the GLB level is fine.
--
-- We could go slower (every 5 minutes), but then Publish UX
-- feels broken — the operator clicks Publish, watches the
-- banner spin for 4 minutes after Meshy is actually done, and
-- assumes something hung.
--
-- ---------------------------------------------------------------
-- Why X-Cron-Secret and not service-role Bearer
-- ---------------------------------------------------------------
-- The edge function deployed in Commit 5 is intentionally
-- deployed with `--no-verify-jwt`, with its own custom auth
-- check on the X-Cron-Secret header (see index.ts header
-- comment for the full rationale). Three reasons we picked a
-- shared secret over the service-role JWT:
--
--   1. Service-role keys are project-wide blast-radius. If the
--      cron config ever leaks, the attacker has god-mode on the
--      whole project, not just permission to ping one endpoint.
--   2. Rotating a cron secret means: generate new value, set
--      both `app.cron_secret` (here) and the `CRON_SECRET`
--      function secret (Edge Functions UI) to match. Rotating
--      a service-role key means: every other Edge Function +
--      every server-side caller has to be coordinated.
--   3. Symmetric: the edge function only accepts X-Cron-Secret,
--      so anyone with just the JWT (e.g. a leaked Bearer token
--      from another service) cannot invoke poll-meshy.
--
-- The migration reads the secret from a Postgres custom GUC,
-- `app.cron_secret`. The operator has to set this once before
-- deploying (see "Pre-deploy operator step" below). If unset,
-- `current_setting('app.cron_secret', true)` returns NULL, the
-- header value becomes NULL, and the edge function rejects with
-- 401 — fail-closed.
--
-- ---------------------------------------------------------------
-- Why timeout 30s
-- ---------------------------------------------------------------
-- pg_net is async — net.http_post returns a request_id
-- immediately and the actual HTTP call happens in pg_net's
-- background worker. The `timeout_milliseconds` arg is the
-- ceiling for how long the background worker waits for a
-- response before giving up. Default is 1000ms in pg_net
-- (*much* too short; the edge function legitimately needs to
-- download a multi-MB GLB and upload it to Storage when a task
-- completes). 30000ms = 30s gives the worker comfortable room
-- without letting a hung request pile up indefinitely.
--
-- If a tick *does* time out, no harm done — the next tick will
-- pick up the same in-flight rows (worker is idempotent: see
-- worker.ts header on the SUCCEEDED branch's transient-vs-
-- terminal classification). Worst case: ~1 minute of extra
-- latency on the affected product.
--
-- ---------------------------------------------------------------
-- Idempotency
-- ---------------------------------------------------------------
-- pg_cron 1.4+ guarantees that `cron.schedule(jobname, schedule,
-- command)` is idempotent on the jobname — a second call with
-- the same name updates the existing row in cron.job in place.
-- We're on 1.6.4 (verified via `select extversion from
-- pg_extension where extname='pg_cron'` post-0016). So this
-- migration is safe to re-run, which matches how supabase-cli
-- replays migrations on branch creation / db reset.
--
-- ---------------------------------------------------------------
-- Pre-deploy operator step (REQUIRED before this is functional)
-- ---------------------------------------------------------------
-- The cron job is dormant until two things are in place:
--
--   1. The edge function is deployed (Commit 5's deploy steps).
--      Until then, every tick HTTP-POSTs to a 404. pg_net logs
--      the failure to net._http_response and moves on. No DB
--      damage, no log spam, but also no useful work happens.
--
--   2. `app.cron_secret` is set on the database. This has to
--      match the `CRON_SECRET` value set as an Edge Function
--      secret (`supabase secrets set CRON_SECRET=...`). Set it
--      once via:
--
--        alter database postgres set app.cron_secret = '<value>';
--
--      The setting persists across restarts. Subsequent rotations
--      use the same statement with the new value. Until set, the
--      edge function returns 401 on every tick (fail-closed).
--
-- Both steps are deferred to after Commit 7 lands per Jym's
-- instruction — Commits 5/6/7 are intentionally landable as a
-- batch with no production calls until the operator chooses to
-- flip the switch.
--
-- ---------------------------------------------------------------
-- Verification (post-apply)
-- ---------------------------------------------------------------
--   select jobid, jobname, schedule, active
--     from cron.job
--    where jobname = 'poll-meshy';
--   → expect 1 row, schedule '* * * * *', active=true.
--
--   -- After ~1-2 minutes, check that ticks are firing:
--   select status, return_message, start_time
--     from cron.job_run_details
--    where jobid = (select jobid from cron.job where jobname='poll-meshy')
--    order by start_time desc limit 3;
--   → expect status='succeeded' rows (the *cron* succeeds — it
--     enqueued a request via net.http_post; the actual HTTP
--     response lives in net._http_response).
--
--   -- HTTP-level outcome (after function deploys):
--   select status_code, content
--     from net._http_response
--    order by created desc limit 3;
--   → expect 200 with JSON {"ok":true,...} once the function
--     is live, 404 / 401 before then.
--
-- ---------------------------------------------------------------
-- Rollback
-- ---------------------------------------------------------------
--   select cron.unschedule('poll-meshy');
-- ...drops the row from cron.job, halts the timer immediately.
-- The two extensions installed in 0016 stay; they're cheap to
-- have around and Commit 7 doesn't touch them.

begin;

-- The 3-arg cron.schedule(jobname, schedule, command) form
-- updates the existing row if the jobname already exists, so
-- this is safe to re-run.
--
-- The command is wrapped in a dollar-quoted string so we don't
-- have to escape the embedded single quotes around the URL,
-- header values, etc.
select cron.schedule(
  'poll-meshy',
  '* * * * *',
  $cron$
  select net.http_post(
    url := 'https://mooggzqjybwuprrsgnny.supabase.co/functions/v1/poll-meshy',
    headers := jsonb_build_object(
      'X-Cron-Secret', current_setting('app.cron_secret', true),
      'Content-Type',  'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $cron$
);

commit;
