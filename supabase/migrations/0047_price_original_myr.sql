-- Wave: AI extraction completeness. Add a compare-at / original price
-- column so the spec parser can record BOTH a struck-through original
-- (RCP / list / "was") price and the selling price. price_myr stays the
-- actual selling price; price_original_myr is the higher original price
-- shown only when a discount is printed on the spec sheet. NULL = no
-- discount (storefront shows just price_myr).
alter table products add column if not exists price_original_myr numeric;

comment on column products.price_original_myr is
  'Compare-at / RCP / original list price in MYR. When set and > price_myr the storefront shows it struck-through next to the selling price. NULL = no discount.';
