-- Defect marking — a human-verified "this product is bad, don't ship it".
--
-- Not a status. status stays draft/published/archived/link_broken; defect is
-- an orthogonal boolean an operator raises after EYEBALLING the result (a
-- scene image that installed the product wrong, a broken 3D model, wrong
-- data). A product can be a published defect (spotted after going live) or a
-- draft defect — the flag doesn't move it between states, it just blocks
-- publishing until someone clears it.
--
--   defect         — raised/cleared by the operator from the product list.
--   defect_reason  — why, so the next person knows what to fix. Free text;
--                    the UI offers presets (scene image / 3D model / data)
--                    but does not constrain the column.
--
-- Enforcement lives in checkPublishGates (src/lib/publish-gates.ts) as a
-- sixth gate, so the "Ready to publish" filter and the bulk-publish action
-- both honour it without any extra logic of their own.
alter table public.products
  add column if not exists defect boolean not null default false,
  add column if not exists defect_reason text;

-- The list's "Defect (N)" filter scans for the flagged minority; a partial
-- index keeps that cheap and stays tiny (only flagged rows are indexed).
create index if not exists products_defect_idx
  on public.products (defect)
  where defect = true;

notify pgrst, 'reload schema';
