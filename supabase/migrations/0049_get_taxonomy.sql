-- 0049_get_taxonomy.sql
-- Collapse loadTaxonomy()'s 8 parallel PostgREST round-trips into ONE
-- read-only RPC that returns the whole taxonomy as a single JSON object.
-- On a healthy link 8 parallel queries are fine, but on a constrained /
-- high-latency connection the 8-way fan-out serialises badly (observed
-- ~29s vs ~5s for a single request) and any one failed leg used to poison
-- the unstable_cache with an empty result. One request = one connection,
-- one latency, all-or-nothing.
--
-- SECURITY INVOKER (default): runs with the caller's (anon) privileges,
-- which already have SELECT on every taxonomy table — no privilege change.
-- STABLE: no writes; safe to cache.
create or replace function public.get_taxonomy()
returns json
language sql
stable
as $$
  select json_build_object(
    'itemTypes',     (select coalesce(json_agg(t order by t.label_en), '[]'::json) from public.item_types t),
    'itemSubtypes',  (select coalesce(json_agg(t order by t.label_en), '[]'::json) from public.item_subtypes t),
    'itemTypeRooms', (select coalesce(json_agg(t order by t.sort_order), '[]'::json) from public.item_type_rooms t),
    'rooms',         (select coalesce(json_agg(t order by t.label_en), '[]'::json) from public.rooms t),
    'styles',        (select coalesce(json_agg(t order by t.label_en), '[]'::json) from public.styles t),
    'materials',     (select coalesce(json_agg(t order by t.label_en), '[]'::json) from public.materials t),
    'colors',        (select coalesce(json_agg(t order by t.sort_order), '[]'::json) from public.colors t),
    'regions',       (select coalesce(json_agg(t order by t.sort_order), '[]'::json) from public.regions t)
  );
$$;

grant execute on function public.get_taxonomy() to anon, authenticated, service_role;

notify pgrst, 'reload schema';
