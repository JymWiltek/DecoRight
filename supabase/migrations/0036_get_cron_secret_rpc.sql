-- 0036 — RPC bridge to private._app_config.cron_secret.
--
-- Why: PostgREST's exposed schemas list (default: public, graphql_public)
-- intentionally excludes `private`, so the supabase-js client can't
-- read private._app_config directly. Our Vercel-side route needs the
-- cron_secret value to verify pg_net trigger callbacks. A SECURITY
-- DEFINER function in `public` is the standard PostgREST escape hatch.
--
-- Auth model:
--   • SECURITY DEFINER: runs as the function owner (postgres), which
--     can SELECT from private._app_config.
--   • REVOKE FROM PUBLIC + GRANT TO service_role ONLY: anon and
--     authenticated cannot invoke. Only the service-role-key path
--     (server-side) can read.
--   • search_path = '' per security audit (mig 0029) — function body
--     uses fully-qualified names.

create or replace function public.get_cron_secret()
returns text
language sql
security definer
set search_path = ''
as $$
  select value from private._app_config where key = 'cron_secret' limit 1;
$$;

-- Lock it down to service_role only.
revoke all on function public.get_cron_secret() from public;
revoke all on function public.get_cron_secret() from anon, authenticated;
grant execute on function public.get_cron_secret() to service_role;
