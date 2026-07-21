-- Brands as a first-class table, managed from Settings → Brand.
--
-- Until now the brand picker's option list was DISTINCT products.brand — so a
-- brand only existed as long as some product used it, and a typo could never
-- be removed without touching products. This gives brands their own home:
-- Settings can add / delete entries here, and loadKnownBrands() reads this
-- table instead of scanning products.
--
--   name  — the canonical spelling (the normalizeBrand output). UNIQUE so the
--           same brand can't be added twice. Case variants are prevented by
--           the app running normalizeBrand before insert; a lower(name) index
--           makes that guarantee hold at the DB level too.
create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

-- Belt-and-suspenders: block case-variant duplicates ("Roca" vs "roca") even
-- if some future path forgets to normalize first.
create unique index if not exists brands_name_lower_idx
  on public.brands (lower(name));

-- Seed from the brands products already carry. The catalog was normalized in
-- an earlier one-off, so DISTINCT already yields canonical spellings; the
-- DISTINCT ON (lower(...)) is a safety net that keeps one row per
-- case-insensitive brand regardless. Null / blank excluded.
insert into public.brands (name)
select distinct on (lower(trim(brand))) trim(brand)
from public.products
where brand is not null and trim(brand) <> ''
order by lower(trim(brand)), trim(brand)
on conflict do nothing;

notify pgrst, 'reload schema';
