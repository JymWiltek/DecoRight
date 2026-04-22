-- =====================================================================
-- 0005 · fix "column reference cost_usd is ambiguous" in reserve_api_slot
--
-- The function declares `returns table(usage_id uuid, cost_usd numeric)`,
-- which introduces `cost_usd` as an output parameter visible inside the
-- function body. The body then has:
--
--     where service = p_service
--       and cost_usd > 0
--       and (created_at at time zone 'UTC')::date = ...
--
-- and Postgres (rightly) refuses to disambiguate `cost_usd` between the
-- output parameter and the api_usage column. The function would raise
-- on the very first reserveSlot() call from src/lib/api-usage.ts.
--
-- Fix: qualify the column references with `api_usage.` so the planner
-- has no doubt. Same change is applied in 0003 so fresh installs avoid
-- the bug entirely; this 0005 patches existing installs.
-- =====================================================================

create or replace function public.reserve_api_slot(
  p_service          text,
  p_product_id       uuid default null,
  p_product_image_id uuid default null,
  p_note             text default null
) returns table(usage_id uuid, cost_usd numeric)
language plpgsql security definer as $$
declare
  v_id          uuid;
  v_cost        numeric;
  v_limit       int;
  v_used_today  int;
  v_stop        boolean;
begin
  if p_service not in ('replicate_rembg','removebg','meshy') then
    raise exception 'unknown service %', p_service;
  end if;

  perform pg_advisory_xact_lock(hashtext('api_slot_' || p_service));

  select (value)::boolean into v_stop
    from public.app_config where key='emergency_stop';
  if coalesce(v_stop, false) then
    raise exception 'emergency_stop is on — refusing to call %', p_service;
  end if;

  select (value)::int into v_limit
    from public.app_config
    where key = p_service || '_daily_limit';
  if v_limit is null then
    raise exception 'no daily_limit configured for service %', p_service;
  end if;

  select (value)::numeric into v_cost
    from public.app_config
    where key = p_service || '_cost_per_call_usd';
  if v_cost is null then
    raise exception 'no cost_per_call_usd configured for service %', p_service;
  end if;

  -- Qualified references avoid clash with the RETURNS TABLE output param.
  select count(*) into v_used_today
    from public.api_usage
   where api_usage.service = p_service
     and api_usage.cost_usd > 0
     and (api_usage.created_at at time zone 'UTC')::date
         = (now() at time zone 'UTC')::date;

  if v_used_today >= v_limit then
    raise exception 'daily_limit reached for % (% / %)', p_service, v_used_today, v_limit;
  end if;

  insert into public.api_usage
    (service, product_id, product_image_id, status, note, cost_usd)
  values
    (p_service, p_product_id, p_product_image_id, 'reserved', p_note, v_cost)
  returning id into v_id;

  usage_id := v_id;
  cost_usd := v_cost;
  return next;
end $$;

revoke all on function public.reserve_api_slot(text, uuid, uuid, text) from public;
grant execute on function public.reserve_api_slot(text, uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';
