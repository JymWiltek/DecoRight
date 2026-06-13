-- 0046 — Wave 12: storefront redesign support.
--   • products.designer_guide — markdown blurb shown in the new
--     "Designer's Guide" section on /product/[id]. Operator writes it
--     in the admin edit page. Nullable; old products render no section.
--   • products.download_credit_cost — integer "X credit" shown on the
--     product card + the Download FBX button. DISPLAY-ONLY this wave
--     (no paywall / no deduction — that is a later wave). Defaults to 5
--     so every existing product shows a sensible number without a
--     backfill pass.
--
-- Both strictly additive; existing rows + queries keep working.

alter table public.products
  add column if not exists designer_guide       text,
  add column if not exists download_credit_cost integer not null default 5;

notify pgrst, 'reload schema';
