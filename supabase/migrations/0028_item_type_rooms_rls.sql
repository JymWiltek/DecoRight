-- 0028 — Enable RLS on item_type_rooms (taxonomy M2M relation table).
--
-- Why: Supabase Security Advisor flagged this table as RLS Disabled, exposing
--      it to public DELETE/UPDATE/INSERT from the anon key. Although the table
--      contains only public taxonomy data (which item_types live in which rooms),
--      a malicious anon caller could DELETE every row and break /room/* pages
--      across the storefront.
--
-- The other 7 taxonomy tables (rooms / item_types / item_subtypes / styles /
-- materials / colors / regions) all already have RLS enabled with a
-- "public read <table>" policy. This was the only one missed during the
-- taxonomy wave (mig 0013 created it without RLS).
--
-- Mirrors the rooms / item_types / styles policy pattern from mig 0002:
--   * SELECT public for anon + authenticated (storefront needs to read it).
--   * No INSERT/UPDATE/DELETE policy -> defaults to deny on the public anon key.
--     Service-role queries bypass RLS so admin / migrations are unaffected.

alter table public.item_type_rooms enable row level security;

drop policy if exists "public read item_type_rooms" on public.item_type_rooms;
create policy "public read item_type_rooms" on public.item_type_rooms
  for select to anon, authenticated using (true);
