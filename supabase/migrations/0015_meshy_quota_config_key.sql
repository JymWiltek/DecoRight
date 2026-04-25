-- 0015_meshy_quota_config_key.sql
--
-- Hotfix found while wiring Phase A Milestone 2's first paid call.
--
-- The reserve_api_slot(p_service text, ...) RPC defined in migration
-- 0003 (and again in 0004) always looks up its per-call price under
-- the key `<p_service>_cost_per_call_usd`:
--
--     select v.value::numeric into v_cost
--       from public.app_config v
--      where key = p_service || '_cost_per_call_usd';
--     if v_cost is null then
--       raise exception 'no cost_per_call_usd configured for service %', p_service;
--     end if;
--
-- The seed in 0003 inserted the rembg keys with the matching suffix
-- (`replicate_rembg_cost_per_call_usd`, `removebg_cost_per_call_usd`)
-- but inserted the meshy key as `meshy_cost_per_job_usd`. Fine while
-- meshy was untested — but the moment we call reserveSlot('meshy')
-- the RPC raises "no cost_per_call_usd configured for service meshy".
-- The Milestone 2 smoke test (test-mode key, scripts/meshy-smoke.ts)
-- caught it on the first run.
--
-- Fix: add the right key, drop the wrong one. We keep the value
-- (0.25) since that's still the agreed Phase A budget.
--
-- Why not edit the RPC instead: the RPC's `_cost_per_call_usd`
-- naming IS the convention — three of three sibling services use
-- it. Renaming would mean touching the function signature, the
-- two existing keys, and any future lookup. Adjusting one config
-- key is one line.

begin;

-- 1. Add the correctly-named key.
insert into public.app_config (key, value)
values ('meshy_cost_per_call_usd', '0.25')
on conflict (key) do update set value = excluded.value;

-- 2. Remove the wrong-named key. on conflict do nothing on insert
--    above would leave both rows; cleaner to drop the stale one so
--    operators editing the admin spend page don't see two near-
--    identical entries.
delete from public.app_config
 where key = 'meshy_cost_per_job_usd';

commit;
