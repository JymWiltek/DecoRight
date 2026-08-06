-- Publish audit — WHO/WHAT published a product and WHEN.
--
-- Motivation: the 2026-08-05 incident (a batch of products went live without
-- anyone clicking Publish) could only be diagnosed by inference from
-- updated_at, because there was no record of what performed a publish. These
-- two columns make every future publish self-documenting.
--
--   published_by — the path that flipped the row live:
--     'manual' — a human clicked Publish/Save on a single product
--                (updateProduct / setProductStatusAction).
--     'bulk'   — a human clicked Bulk Publish (bulkUpdateStatusAction).
--     NULL     — never published (draft), or published before this column
--                existed (legacy).
--   published_at — timestamp of the draft→published transition. Set ONLY on the
--                  transition, not on re-saves of an already-published row.
--
-- After this PR there is NO automatic publish path — every value here is 'manual'
-- or 'bulk'. If a row ever shows published with published_by NULL going forward,
-- that itself is the alarm.
alter table public.products
  add column if not exists published_by text
    check (published_by in ('manual', 'bulk')),
  add column if not exists published_at timestamptz;

notify pgrst, 'reload schema';
