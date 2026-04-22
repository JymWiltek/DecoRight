-- =====================================================================
-- 0008 · flip taxonomy source-of-truth from Chinese to English
--
-- Business reframe: DecoRight is a Malaysian SaaS that will sign vendor
-- contracts, emit SEO canonical URLs, and publish legal docs — all in
-- English. Chinese and Malay are translations of the canonical English
-- term, not the other way around. (Same model as Shopee, Lazada, Apple.)
--
-- Concretely:
--   - label_en    NOT NULL  ← new canonical source
--   - label_zh    NULLABLE  ← translation (was NOT NULL)
--   - label_ms    NULLABLE  ← translation (unchanged)
--
-- The fallback chain in src/lib/taxonomy.ts labelFor() now resolves
-- `locale → label_en → slug` instead of `locale → label_zh`. Auto-
-- translate (OpenAI GPT-4o-mini) now goes EN → ZH + MS.
--
-- SAFETY GUARD: we refuse to add NOT NULL on label_en while any row
-- still has it null, which would raise a cryptic constraint-violation
-- error mid-migration. Instead we raise a friendly exception up front
-- so the operator knows the fix: click "Auto-translate missing" on
-- /admin/taxonomy first (that was the old-direction code, ZH → EN/MS),
-- which populates label_en everywhere. Then re-run this migration.
-- =====================================================================

do $$
declare
  n_missing int;
begin
  select sum(c)::int into n_missing from (
    select count(*) c from public.rooms          where label_en is null
    union all select count(*) from public.item_types    where label_en is null
    union all select count(*) from public.item_subtypes where label_en is null
    union all select count(*) from public.styles        where label_en is null
    union all select count(*) from public.materials     where label_en is null
    union all select count(*) from public.colors        where label_en is null
  ) t;
  if n_missing > 0 then
    raise exception
      'Cannot apply 0008: % taxonomy row(s) still have label_en IS NULL. '
      'Fix first by clicking "Auto-translate missing" on /admin/taxonomy '
      '(that fills label_en from label_zh), then re-run this migration.',
      n_missing;
  end if;
end $$;

-- Promote label_en to the canonical source column.
alter table public.rooms          alter column label_en set not null;
alter table public.item_types     alter column label_en set not null;
alter table public.item_subtypes  alter column label_en set not null;
alter table public.styles         alter column label_en set not null;
alter table public.materials      alter column label_en set not null;
alter table public.colors         alter column label_en set not null;

-- Demote label_zh to "just another translation".
alter table public.rooms          alter column label_zh drop not null;
alter table public.item_types     alter column label_zh drop not null;
alter table public.item_subtypes  alter column label_zh drop not null;
alter table public.styles         alter column label_zh drop not null;
alter table public.materials      alter column label_zh drop not null;
alter table public.colors         alter column label_zh drop not null;

notify pgrst, 'reload schema';
