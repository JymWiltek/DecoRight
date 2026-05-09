-- 0033 — Add sku_id to products.
--
-- Why: brand spec sheets use SKU codes like "WD012", "A400-PS",
-- "DCS-ECWC" as the canonical identifier. Operators need to record
-- and surface them. Wave 3 (later) will auto-fill this from a
-- spec-sheet image via GPT-4o vision; Wave 1 (this commit) ships the
-- column + admin field + storefront row so the manual path lands
-- ahead of the AI integration.
--
-- Nullable + no default: not every product has a manufacturer SKU
-- (some are unbranded display items). NULL means "no SKU recorded";
-- the storefront renders an em-dash placeholder for null + missing.

alter table public.products
  add column if not exists sku_id text;
