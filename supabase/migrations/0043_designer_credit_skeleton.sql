-- 0043 — Wave 10: designer + credit + bundle skeleton.
--
-- This wave starts the paid-FBX-download business model. Today's
-- storefront still serves FBX freely (Wave 9 added the unconditional
-- Download FBX button) because the designer-facing front-end isn't
-- built yet. Wave 10 lays the DB groundwork + admin UI so Jym can
-- manually onboard designers, top up credit, build bundles, and
-- record manual sales while the customer-facing parts come online
-- piecemeal.
--
-- Hard rule honored: nothing in this migration touches the existing
-- `products`, `product_images`, or any pre-Wave-10 table. Strictly
-- additive — six new tables + their indexes/constraints.
--
-- Tables:
--   designers              — paid-designer accounts (admin-managed for now)
--   credit_balances        — current credit per designer (1:1, dense row)
--   credit_transactions    — append-only ledger of every credit move
--   subscriptions          — recurring credit grants
--   bundles                — curated product packs
--   bundle_products        — bundle ↔ products M:N
--   downloads              — append-only ledger of every paid download

create table public.designers (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  name          text not null,
  whatsapp      text,
  -- Auth deferred: password_hash stays null in Wave 10 (admin onboards
  -- + tops up; designer self-login lands in a later wave). Storing it
  -- here so we don't have to ALTER TABLE when login lands.
  password_hash text,
  status        text not null default 'active'
                check (status in ('active', 'suspended')),
  created_at    timestamptz not null default now(),
  last_login_at timestamptz,
  admin_note    text
);

create index idx_designers_status on public.designers(status);

-- 1:1 with designers. Kept separate so credit reads (the hottest
-- query in the system once designers are live) don't drag the
-- profile + auth columns. Also lets a future trigger maintain the
-- balance from credit_transactions if we want strict consistency.
create table public.credit_balances (
  designer_id    uuid primary key
                 references public.designers(id) on delete cascade,
  credit_balance integer not null default 0
                 check (credit_balance >= 0),
  updated_at     timestamptz not null default now()
);

-- Append-only ledger. Every credit move (admin top-up, download
-- spend, refund, subscription grant) lands here as a signed `amount`
-- and the balance is the running sum. `type` is the enum of paths;
-- `related_*` ties spends back to the artifact the designer paid for.
create table public.credit_transactions (
  id                 uuid primary key default gen_random_uuid(),
  designer_id        uuid not null
                     references public.designers(id) on delete cascade,
  type               text not null
                     check (type in ('purchase', 'download', 'refund',
                                     'admin_adjust', 'subscription_grant')),
  -- Signed integer. Positive = credit added (purchase, refund,
  -- subscription_grant), negative = credit spent (download), either
  -- direction allowed for admin_adjust.
  amount             integer not null,
  description        text,
  related_product_id uuid references public.products(id),
  related_bundle_id  uuid,  -- FK added at the end (bundles defined below)
  admin_note         text,
  created_at         timestamptz not null default now()
);

create index idx_credit_transactions_designer
  on public.credit_transactions(designer_id, created_at desc);

-- Recurring credit grant. plan is the catalog SKU (starter, pro,
-- studio), monthly_credit + monthly_price_myr cached at sub time so
-- a plan-pricing change doesn't retroactively rewrite existing
-- subscriptions' price. `payment_method` is 'manual' for Wave 10 —
-- Stripe lands in a later wave + writes 'stripe' here.
create table public.subscriptions (
  id                uuid primary key default gen_random_uuid(),
  designer_id       uuid not null
                    references public.designers(id) on delete cascade,
  plan              text not null
                    check (plan in ('starter', 'pro', 'studio')),
  monthly_credit    integer not null check (monthly_credit > 0),
  -- In MYR cents: RM29.00 = 2900. integer not numeric — RM cents
  -- never have sub-cent precision.
  monthly_price_myr integer not null check (monthly_price_myr > 0),
  status            text not null default 'active'
                    check (status in ('active', 'paused', 'cancelled')),
  started_at        timestamptz not null default now(),
  expires_at        timestamptz,
  payment_method    text not null default 'manual',
  admin_note        text
);

create index idx_subscriptions_designer
  on public.subscriptions(designer_id, status);

-- Curated product pack. Designer can spend `credit_cost` to unlock
-- every product in the bundle in one click. `slug` drives the
-- future storefront URL `/bundle/<slug>`. `status='draft'` hides
-- from designer-facing surfaces during admin curation.
create table public.bundles (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  slug            text unique not null,
  description     text,
  credit_cost     integer not null check (credit_cost >= 0),
  status          text not null default 'draft'
                  check (status in ('draft', 'published')),
  created_at      timestamptz not null default now(),
  cover_image_url text
);

create index idx_bundles_status on public.bundles(status);

-- M:N. ON DELETE CASCADE on both sides keeps the join table clean
-- when a bundle is dropped or a product is hard-deleted (rare —
-- products are usually soft-archived via status='archived').
create table public.bundle_products (
  bundle_id  uuid not null
             references public.bundles(id) on delete cascade,
  product_id uuid not null
             references public.products(id) on delete cascade,
  sort_order integer not null default 0,
  primary key (bundle_id, product_id)
);

create index idx_bundle_products_bundle
  on public.bundle_products(bundle_id, sort_order);

-- Append-only ledger of every paid download. Stays separate from
-- credit_transactions so a future analytics query "what's the
-- top-downloaded product this month" doesn't need to scan the much
-- larger credit ledger. `credit_cost` cached at download time so a
-- product/bundle price change later doesn't rewrite history.
create table public.downloads (
  id            uuid primary key default gen_random_uuid(),
  designer_id   uuid not null
                references public.designers(id) on delete cascade,
  product_id    uuid references public.products(id),
  bundle_id     uuid references public.bundles(id),
  credit_cost   integer not null check (credit_cost >= 0),
  file_type     text not null check (file_type in ('fbx', 'glb')),
  downloaded_at timestamptz not null default now(),
  ip_address    text,
  user_agent    text,
  -- One of product_id / bundle_id must be set (which artifact was
  -- downloaded). Enforced via CHECK rather than a partial unique
  -- index because both flows append per-download.
  check ((product_id is not null)::int + (bundle_id is not null)::int = 1)
);

create index idx_downloads_designer
  on public.downloads(designer_id, downloaded_at desc);

create index idx_downloads_product
  on public.downloads(product_id) where product_id is not null;

create index idx_downloads_bundle
  on public.downloads(bundle_id) where bundle_id is not null;

-- Forward-reference FK for credit_transactions.related_bundle_id.
-- Bundles table was defined above this point so the constraint is
-- valid; we add it separately to keep the credit_transactions DDL
-- block readable (no circular-define gymnastics).
alter table public.credit_transactions
  add constraint credit_transactions_bundle_fkey
  foreign key (related_bundle_id) references public.bundles(id);

notify pgrst, 'reload schema';
