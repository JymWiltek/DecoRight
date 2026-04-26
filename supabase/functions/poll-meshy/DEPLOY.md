# `poll-meshy` — deployment & secrets runbook

Phase A · Milestone 3 · Commit 7 of 7.

This document is the **operator's checklist** for taking the
Meshy polling pipeline from "code merged" to "actually polling
Meshy in production." It's intentionally one file in one place
— if you ever wonder "what does the operator have to do to make
3D generation work end-to-end," start here.

The pipeline has three independent moving parts. **All three**
have to be configured for the system to function:

| # | What                        | Where it runs           | Needs        |
|---|-----------------------------|-------------------------|--------------|
| 1 | Publish kickoff + Retry     | Next.js (Vercel)        | `MESHY_API_KEY` env var |
| 2 | Poll worker (Edge Function) | Supabase Edge Functions | `MESHY_API_KEY` + `CRON_SECRET` secrets |
| 3 | Cron schedule               | Postgres (pg_cron)      | `app.cron_secret` GUC matching #2's `CRON_SECRET` |

Skip any one and you get a partial outage that's annoying to
diagnose:

- Skip #1 → operator clicks Publish, gets "manual GLB only" fallback.
- Skip #2 → tasks kick off OK but rows sit in `meshy_status='generating'` forever.
- Skip #3 → poll worker is deployed but nothing ever calls it (or it 401s every tick).

---

## Prerequisites

- A real Meshy account with a paid API key
  (test key `msy_dummy_api_key_for_test_mode_12345678` works for
  local dev only — it returns simulated results, never real GLBs).
- Supabase project access (to set Edge Function secrets and run
  `ALTER DATABASE`).
- Vercel project access (to set the production env var).
- Local install: `npx supabase --version` should print something
  (we use `npx`, no global install needed).

---

## Step 1 — Vercel: set `MESHY_API_KEY` for Next.js

This is the key the **kickoff path** uses (Publish button +
Retry button → `src/lib/meshy-kickoff.ts` → `src/lib/meshy.ts`).

Via the Vercel dashboard:

1. Project → Settings → Environment Variables.
2. Add new:
   - **Key**: `MESHY_API_KEY`
   - **Value**: your real Meshy key (`msy_...`)
   - **Environments**: Production (and Preview if you want preview
     branches to be able to kick off real Meshy jobs — usually
     yes, but be aware each kickoff burns ~$0.05 of credit).
3. Redeploy the production deployment so the new env is picked up
   (Vercel does NOT propagate env changes to a running deployment).

Or via the Vercel CLI:

```bash
vercel env add MESHY_API_KEY production
# paste the key when prompted
vercel --prod  # redeploy
```

Verify by clicking Publish on a draft product with cutouts and
watching the banner flip from "尚未生成" to the blue
"3D 模型生成中..." within a few seconds. If the banner says "no
provider configured" or you see a 401 in Vercel logs, the key
isn't reaching the runtime — re-check the env var was saved and
that you redeployed.

---

## Step 2 — Get a Supabase access token

The CLI needs an access token to talk to the management API. Two
ways to get one:

**Option A — interactive login (easiest):**

```bash
npx supabase login
```

Opens a browser, asks you to authorize, drops a token at
`~/.supabase/access-token`. Subsequent CLI calls just work.

**Option B — manual token (CI / scripted):**

1. Open https://supabase.com/dashboard/account/tokens
2. Click "Generate new token", name it (e.g. `decoright-cli-local`),
   copy the value.
3. Export in your shell:
   ```bash
   export SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxxxxxxxxxxxxxxxxxx
   ```
   (Add to `~/.zshrc` to persist.)

Either way, verify with:

```bash
npx supabase projects list
```

You should see the `decoright` project listed.

---

## Step 3 — Link the local repo to the project

```bash
cd /path/to/decoright
npx supabase link --project-ref mooggzqjybwuprrsgnny
```

It may ask for the database password — needed for `db push` /
`db pull`, **not** needed for what we're doing here (function
deploy + secrets). If you don't have it handy, hit Enter to skip.
(The password is in 1Password under "DecoRight Supabase" — ask
Jym if it's not there.)

After linking, `supabase/.temp/` appears with the project ref
cached. Don't commit it (already in `.gitignore`).

---

## Step 4 — Generate and set the cron secret

This is the secret that gates the Edge Function. It has to match
in **two places** (see table at the top):

```bash
# Generate one shared value:
CRON_SECRET=$(openssl rand -hex 32)
echo "Save this somewhere safe: $CRON_SECRET"

# Set it as an Edge Function secret (read inside the function as
# Deno.env.get('CRON_SECRET')):
npx supabase secrets set CRON_SECRET="$CRON_SECRET"
```

Now set it as a Postgres database setting too, so the cron job's
`current_setting('app.cron_secret', true)` returns the same value:

```bash
# Connect to the Supabase Postgres (use the connection string from
# Settings → Database → Connection string → URI):
psql "$DATABASE_URL" \
  -c "ALTER DATABASE postgres SET app.cron_secret = '$CRON_SECRET';"
```

Or do it via the SQL Editor in the Supabase dashboard:

```sql
ALTER DATABASE postgres SET app.cron_secret = 'paste-the-hex-value';
```

Verify the database setting took:

```sql
SHOW app.cron_secret;
-- expect: paste-the-hex-value
```

> **Why two places?** The Edge Function reads `CRON_SECRET` from
> its Deno runtime env (set via `supabase secrets set`). The cron
> job runs SQL inside Postgres and reads `app.cron_secret` from
> the database's GUC. They're independent stores; the migration
> deliberately uses a setting (not a hardcoded value) so the
> secret is never committed to git.

---

## Step 5 — Set `MESHY_API_KEY` as an Edge Function secret

The same key that's in Vercel from Step 1, but set independently
for the Edge Function runtime (it's a different process / runtime
/ deployment unit):

```bash
npx supabase secrets set MESHY_API_KEY="msy_your_real_key_here"
```

Verify all three secrets are now in place:

```bash
npx supabase secrets list
```

Expect to see `MESHY_API_KEY` and `CRON_SECRET`. (`SUPABASE_URL`
and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected by the
runtime — they don't need to be set here.)

---

## Step 6 — Deploy the Edge Function

```bash
npx supabase functions deploy poll-meshy --no-verify-jwt
```

The `--no-verify-jwt` flag is **important** — it tells Supabase
to skip the default JWT auth check on the function. We do our
own auth via the `X-Cron-Secret` header (see
`supabase/functions/poll-meshy/index.ts` header for why).

Expected output:

```
Bundling Function: poll-meshy
Deploying Function: poll-meshy (project ref: mooggzqjybwuprrsgnny)
Deployed Function: poll-meshy
You can inspect your deployment in the Dashboard:
  https://supabase.com/dashboard/project/mooggzqjybwuprrsgnny/functions
```

---

## Step 7 — Smoke test the deploy

A handful of curls confirm each layer of the security model is
wired correctly.

**7a. No header → 401:**

```bash
curl -i -X POST https://mooggzqjybwuprrsgnny.supabase.co/functions/v1/poll-meshy
```

Expect: `HTTP/2 401` and body `{"ok":false,"error":"unauthorized"}`.

**7b. Wrong header value → 401:**

```bash
curl -i -X POST https://mooggzqjybwuprrsgnny.supabase.co/functions/v1/poll-meshy \
  -H "X-Cron-Secret: wrong-value"
```

Expect: `HTTP/2 401`.

**7c. Correct header → 200:**

```bash
curl -i -X POST https://mooggzqjybwuprrsgnny.supabase.co/functions/v1/poll-meshy \
  -H "X-Cron-Secret: $CRON_SECRET"
```

Expect: `HTTP/2 200` with body like:

```json
{"ok":true,"durationMs":42,"scanned":0,"outcomes":[]}
```

(`scanned: 0` because no rows are in `meshy_status='generating'`
unless you've kicked off a real task. That's the happy idle state.)

---

## Step 8 — Verify the cron is actually firing

The cron job was registered by migration `0017` (Commit 6) and
has been ticking every minute since. Once Step 4-6 are done, the
ticks should start landing successfully.

```sql
-- Cron-level: did the SQL command run?
SELECT status, return_message, start_time
  FROM cron.job_run_details
 WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'poll-meshy')
 ORDER BY start_time DESC
 LIMIT 5;
```

Expect `status = 'succeeded'` (the SQL `select net.http_post(...)`
itself ran fine — it just enqueued an async HTTP request).

```sql
-- HTTP-level: what did the function actually return?
SELECT id, status_code, content
  FROM net._http_response
 ORDER BY created DESC
 LIMIT 5;
```

What you should see:

| Stage | `status_code` | `content` |
|-------|---------------|-----------|
| Before Step 6 (function not deployed) | `404` | (some HTML or empty) |
| After Step 6 but Step 4 incomplete    | `401` | `{"ok":false,"error":"unauthorized"}` |
| After Steps 4–6 all complete          | `200` | `{"ok":true,"scanned":N,"outcomes":[...]}` |

Once you're seeing `200`s, the pipeline is live. End-to-end test:

1. Open the Edit page for a draft product with ≥1 cutout.
2. Click Publish.
3. Banner flips to blue ("3D 模型生成中...").
4. Wait 60-180 seconds.
5. Banner flips to green and the row's `status` is now
   `'published'`.

---

## Rotating `CRON_SECRET`

Routine maintenance, ~yearly or after any suspected leak:

```bash
NEW_SECRET=$(openssl rand -hex 32)

# Edge Function side:
npx supabase secrets set CRON_SECRET="$NEW_SECRET"

# Database side (do this within ~60s of the above to minimize
# the window where ticks 401):
psql "$DATABASE_URL" \
  -c "ALTER DATABASE postgres SET app.cron_secret = '$NEW_SECRET';"
```

The Edge Function picks up the new secret on its next cold start
(could be up to a few minutes). The DB setting is read on every
tick. Worst-case window of 401-ing ticks: ~1-2 minutes. No data
loss — the worker is idempotent on in-flight rows, so the next
successful tick picks up everything that the failed ticks would
have processed.

---

## Pausing the system

If Meshy is having an outage, or you want to halt all 3D
generation for any reason:

```sql
-- Stop the cron immediately (in-flight rows just stay
-- 'generating' until you re-enable):
SELECT cron.unschedule('poll-meshy');
```

To resume, re-apply migration `0017` (it's idempotent):

```bash
npx supabase db push
```

Or run the `cron.schedule(...)` block directly via SQL Editor.

---

## Troubleshooting

**Symptom: every tick returns 401, and `app.cron_secret` looks set.**
→ The cron job runs as the database owner role. `ALTER DATABASE
postgres SET ...` only takes effect for new connections to that
database. pg_cron's worker pool may have a stale connection. Wait
~60 seconds, or `SELECT pg_reload_conf();` to force a config
reload.

**Symptom: function logs say `MESHY_API_KEY not set in function env`.**
→ You set the Vercel env var (Step 1) but skipped Step 5. Edge
Functions and Vercel are independent runtimes; they don't share
env vars.

**Symptom: rows go straight from `'generating'` to `'failed'` with
`meshy_error = 'GLB stored OK, but auto-promote to "published"
blocked: ...'`.**
→ The GLB landed but the `products_check_rooms_required` trigger
fired (operator edited the row mid-flight and removed all
`room_slugs`). Worker did the right thing — manually fix the
`room_slugs` field and the row will be ready to publish.

**Symptom: function returns 200 with `scanned: 0` even though
you can see rows in `meshy_status = 'generating'` in the DB.**
→ Those rows have `meshy_task_id IS NULL`. The worker only polls
rows with a non-null task ID (see `listInFlight` in `index.ts`).
Either Meshy refused the kickoff (check `meshy_error`), or the
kickoff path is broken — look at Vercel logs for the most recent
Publish click.
