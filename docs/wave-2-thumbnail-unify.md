# Wave 2 — Auto-unify product thumbnails

**Status:** Stage 1 ships the route placeholder + this design. Stage 2
is the full sharp implementation + pg_net trigger.

## Why

Storefront thumbnails today are whatever shape the cutout pipeline
produced. Sizes, paddings, and (lack of) shadows vary across products
because the upstream rembg providers don't enforce a canvas. The
catalog grid shows 12+ tiles side-by-side; inconsistency reads as
"unfinished" even when individual tiles are crisp on their own.

Operator pain: zero. The current flow puts the cost on the visitor's
eye. Wave 2 takes the cost server-side once per product, then every
tile across the catalog reads identical.

## Visual contract (Stage 2 will produce)

- 1500×1500 PNG, sRGB, no alpha — opaque white #FFFFFF.
- Product object centered, occupying **80–85%** of the canvas (so
  ~8% transparent padding left after the trim step).
- Soft ground shadow:
  - elliptical mask, **alpha 15%**, **30 px Gaussian blur**.
  - ellipse width = product bounding-box width × **0.8** (slightly
    narrower than the product so the shadow looks like contact, not
    a moat).
  - vertical position = bottom of the bounding box.
- Output filename pattern: `thumbnails/products/<product_id>.png`.
- Cache-Control: `public, max-age=31536000, immutable` once committed
  to the bucket; storefront thumbnail_url carries a versioning query
  string when the row updates so a re-unify invalidates client cache.

## Pipeline

Implemented in `src/app/api/admin/unify-thumbnail/route.ts`. Stage 1
is a 501 placeholder. Stage 2 implementation steps:

1. `await requireAdmin()` — same auth gate the rest of admin uses.
2. Read `{ product_id }` from the JSON body. Reject if no UUID match.
3. SELECT the product's primary `cutout_image_url` (state =
   `cutout_approved`, image_kind = `cutout`, is_primary = true).
4. Fetch the PNG bytes from Storage (it's a public bucket; a plain
   `fetch()` is fine).
5. sharp pipeline:

   ```ts
   const trimmed = sharp(input).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } });
   const meta = await trimmed.metadata();
   const targetW = Math.floor(1500 * 0.85);
   const scaled = trimmed.resize({
     width: targetW, height: targetW,
     fit: "inside", withoutEnlargement: true,
   });
   const padded = scaled.extend({
     top, bottom, left, right,
     background: { r: 0xFF, g: 0xFF, b: 0xFF, alpha: 1 },
   });
   // Composite an elliptical Gaussian-blurred shadow underneath
   // before flattening (separate sharp() chain rendering the shadow
   // to a PNG buffer, then compose).
   ```

6. Output PNG buffer.
7. `supabase.storage.from('thumbnails').upload('products/<id>.png',
   buf, { upsert: true })`.
8. `UPDATE products SET thumbnail_url = '<public url>?v=<unix>'`.
9. Return `{ ok: true, thumbnail_url, original_bytes, unified_bytes }`.

## Triggers (Stage 2)

Three independent invocation surfaces, all hitting POST
`/api/admin/unify-thumbnail`:

### a) Auto on cutout approval (pg_net)

```sql
-- Stage 2 SQL — DO NOT apply yet. Documented here so the schema
-- review for that migration starts from a known design.
create or replace function public.unify_thumb_on_approve()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.image_kind = 'cutout'
     and new.is_primary
     and new.state = 'cutout_approved'
     and (old.state is distinct from new.state) then
    perform net.http_post(
      url := current_setting('app.api_base_url') || '/api/admin/unify-thumbnail',
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-cron-secret', current_setting('app.cron_secret')
      ),
      body := jsonb_build_object('product_id', new.product_id)::text
    );
  end if;
  return new;
end $$;

create trigger product_images_unify_after_approve
  after update of state, is_primary on public.product_images
  for each row execute function public.unify_thumb_on_approve();
```

The `app.api_base_url` and `app.cron_secret` settings already exist
from the Meshy poller (mig 0018); reuse them. The route will need a
short-circuit branch that bypasses `requireAdmin()` when the
`x-cron-secret` header matches.

### b) Same trigger on skip_cutout=true

If the operator clicks "Skip — already clean" (state lands at
cutout_approved without rembg), the same trigger above fires because
its condition is on `state` flipping to cutout_approved.

### c) Manual admin button

Edit page button ("Re-unify thumbnail") → fetch POST with
`{ product_id }`. Same route, no special-casing.

## Backfill (Stage 2)

One-shot Node script: walk every published product with a primary
`cutout_approved` cutout image and POST to `/api/admin/unify-thumbnail`
for each. Sequential to keep the sharp memory footprint predictable.
Expected runtime ~15 s for the current 13 products.

## Failure modes

| Cause | Behavior |
|---|---|
| Cutout fetch 404 | Skip the unify step; leave `thumbnail_url` as-is. Log to admin via `api_usage` row with status='failed', service='unify_thumb'. |
| sharp throws (corrupt PNG, OOM) | Same — leave thumbnail unchanged, log row, return `ok: false`. |
| Storage upload fails | Same. Storage's atomic upsert means a half-written object can't appear. |
| Auth fails (no admin session, no cron secret) | 401; never reach sharp. |

## Dependencies (Stage 2)

- `npm install sharp` — Node-only; ~7 MB serverless function bundle
  (within Vercel's cap). Keep it out of any client bundle: this
  module is Node-runtime-only (`export const runtime = "nodejs"`).

## Why not Supabase Edge Function

Considered, rejected:

- Deno doesn't have a sharp equivalent that we trust for production
  shadow rendering. ImageMagick WASM has known issues with
  Gaussian-blur edge artifacts at 30-px radii; sharp (libvips) does
  not.
- We already deploy Vercel serverless functions; adding a Deno edge
  function adds a deployment target.
- pg_net works fine against a Vercel URL; the only difference is one
  extra HTTP hop vs. Supabase-internal.
