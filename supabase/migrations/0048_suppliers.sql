-- Supplier system: products ↔ suppliers many-to-many, so one product can
-- be sold by many retailers, and each retailer link carries its own
-- price / stock / buy link / store address / exclusivity.
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  logo_url text,
  type text not null default 'store'
    check (type in ('official','dealer','store','marketplace')),
  website_url text,
  whatsapp text,                                  -- Malaysian number e.g. 60123456789
  region_slugs text[] not null default '{}',      -- covered states (regions.slug)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.product_suppliers (
  id uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products(id)  on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  price_myr numeric,
  stock_status text not null default 'in_stock'
    check (stock_status in ('in_stock','order','discontinued')),
  buy_url text,
  store_address text,
  is_exclusive boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (product_id, supplier_id)
);
create index on public.product_suppliers (product_id);
create index on public.product_suppliers (supplier_id);

alter table public.products
  add column if not exists is_verified_real_product boolean not null default false;

notify pgrst, 'reload schema';
