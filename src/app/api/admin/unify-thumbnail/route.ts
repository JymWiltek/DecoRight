/**
 * /api/admin/unify-thumbnail — Stage 2 placeholder.
 *
 * Final shape (implemented in Stage 2):
 *   POST { product_id: string }
 *     1. Resolve the product's primary cutout_image_url.
 *     2. Download the cutout PNG bytes.
 *     3. sharp() pipeline:
 *          • .trim()                 — drop transparent padding
 *          • .extend(...)            — center on 1500×1500 canvas with
 *                                      ~8% padding (product fills 80-85%)
 *          • white background fill
 *          • soft elliptical drop-shadow (alpha 15%, blur 30px,
 *            ellipse width = bbox × 0.8)
 *     4. Upload the result to thumbnails/products/<product_id>.png.
 *     5. UPDATE products SET thumbnail_url = <new url>.
 *     6. Return { ok, thumbnail_url, original_bytes, unified_bytes }.
 *
 * Trigger surfaces (also Stage 2):
 *   • pg_net trigger on product_images UPDATE when state flips to
 *     cutout_approved AND is_primary=true.
 *   • Same trigger on the skip_cutout=true path.
 *   • Manual admin button on the edit page (re-trigger after the
 *     operator approves a different primary).
 *   • One-shot backfill script for the 13 published products that
 *     pre-date this feature.
 *
 * Why route is committed Stage 1 even though impl is Stage 2:
 *   • Pins the URL contract early so the design doc can reference
 *     it (docs/wave-2-thumbnail-unify.md), the pg_net trigger SQL
 *     in Stage 2 has a stable target, and any frontend "Re-unify"
 *     button can be wired against a known endpoint.
 *   • Returning a 501 is the standard "not implemented" status
 *     code — better than a 404 (route exists) and better than a
 *     stub success (caller might believe the work happened).
 *
 * Auth: when the impl lands in Stage 2, this route MUST guard with
 *   `await requireAdmin()` (the same gate the admin server actions
 *   use) before reading product_id, hitting Storage, or burning
 *   sharp CPU. Adding that guard is part of Stage 2 — DO NOT
 *   skip it. Until impl, the 501 short-circuit means the route
 *   has no side effects to gate against, but a paranoid reader
 *   may want to layer the gate even on the placeholder.
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs"; // sharp will need Node, not Edge.

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "not_implemented",
      detail:
        "Thumbnail unification is scheduled for Stage 2 — see docs/wave-2-thumbnail-unify.md.",
    },
    { status: 501 },
  );
}

// Explicit 405 on every other method so a stray GET doesn't return
// the framework's HTML error page (which can confuse curl-based
// callers comparing against the 501 we expect).
export async function GET() {
  return new NextResponse("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
}
