/**
 * /api/admin/unify-thumbnail — POST { product_id }.
 *
 * Renders a 1500×1500 white-canvas thumbnail with a soft ground
 * shadow from the product's primary cutout, uploads to
 * thumbnails/products/<id>/unified.png, and updates
 * products.thumbnail_url. See docs/wave-2-thumbnail-unify.md for the
 * full design.
 *
 * Auth — accepts EITHER:
 *   • a logged-in admin session cookie (the proxy middleware lets
 *     any /admin/* request through, server actions invoke this
 *     endpoint with the cookie attached); or
 *   • a matching `x-cron-secret` header for pg_net trigger calls
 *     out of Postgres.
 *
 * Both auth paths are independent — the trigger NEVER carries a
 * session cookie, the manual admin button NEVER mints a cron secret.
 *
 * Failure modes — the route always returns JSON:
 *   200 { ok: true, thumbnail_url, … }
 *   400 invalid product_id
 *   401 no session AND no/wrong cron secret
 *   404 product not found OR no primary cutout to unify
 *   500 sharp / fetch / upload threw
 *   501 (replaced once impl lands; this file IS the impl now)
 */

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { unifyThumbnail } from "@/lib/admin/unify-thumbnail";
import { uploadUnifiedThumbnailPng } from "@/lib/storage";
import { PRODUCT_COUNTS_TAG } from "@/lib/products";

export const runtime = "nodejs"; // sharp is a Node addon.
export const maxDuration = 60; // Vercel default is 10s; sharp on a
// large cutout takes 5-15s, plus fetch/upload overhead.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  // ── 1. authenticate ────────────────────────────────────────
  // Prefer the cron-secret path for pg_net trigger calls (those
  // arrive without a browser session cookie). Fall back to the
  // admin session check.
  const cronHeader = req.headers.get("x-cron-secret");
  if (cronHeader) {
    const ok = await verifyCronSecret(cronHeader);
    if (!ok) {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 },
      );
    }
  } else {
    try {
      await requireAdmin();
    } catch {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 },
      );
    }
  }

  // ── 2. parse + validate body ───────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid json body" },
      { status: 400 },
    );
  }
  const productId =
    body && typeof body === "object" && "product_id" in body
      ? String((body as Record<string, unknown>).product_id ?? "")
      : "";
  if (!UUID_RE.test(productId)) {
    return NextResponse.json(
      { ok: false, error: "invalid product_id" },
      { status: 400 },
    );
  }

  // ── 3. resolve primary cutout URL ──────────────────────────
  const supabase = createServiceRoleClient();
  const { data: img, error: imgErr } = await supabase
    .from("product_images")
    .select("id, cutout_image_url")
    .eq("product_id", productId)
    .eq("image_kind", "cutout")
    .eq("state", "cutout_approved")
    .eq("is_primary", true)
    .limit(1)
    .maybeSingle();
  if (imgErr) {
    return NextResponse.json(
      { ok: false, error: "db error", detail: imgErr.message },
      { status: 500 },
    );
  }
  if (!img || !img.cutout_image_url) {
    return NextResponse.json(
      { ok: false, error: "no primary cutout" },
      { status: 404 },
    );
  }

  // ── 4. fetch the cutout PNG bytes ──────────────────────────
  const cutoutResp = await fetch(img.cutout_image_url, {
    cache: "no-store",
  });
  if (!cutoutResp.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "cutout fetch failed",
        detail: `${cutoutResp.status} ${cutoutResp.statusText}`,
      },
      { status: 502 },
    );
  }
  const inputBytes = new Uint8Array(await cutoutResp.arrayBuffer());

  // ── 5. sharp pipeline ──────────────────────────────────────
  let unified;
  try {
    unified = await unifyThumbnail(inputBytes);
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: "unify failed",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }

  // ── 6. upload to thumbnails bucket ─────────────────────────
  let publicUrl: string;
  try {
    publicUrl = await uploadUnifiedThumbnailPng(
      productId,
      new Uint8Array(unified.png),
    );
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: "upload failed",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }

  // ── 7. update products.thumbnail_url with cache-bust query ─
  // The bucket sends 1-year Cache-Control; without a version query
  // the CDN keeps serving the old bytes after a re-unify.
  const versioned = `${publicUrl}?v=${Date.now()}`;
  const { error: updErr } = await supabase
    .from("products")
    .update({ thumbnail_url: versioned })
    .eq("id", productId);
  if (updErr) {
    return NextResponse.json(
      {
        ok: false,
        error: "db update failed",
        detail: updErr.message,
      },
      { status: 500 },
    );
  }

  // ── 8. bust caches that read products.thumbnail_url ───────
  // Wave 2 originally shipped without this and the catalog kept
  // serving the pre-backfill cutout URLs for the entire 5-min ISR
  // window — operator could see the new thumbnail in admin while
  // the storefront stayed stale (incident 2026-05-10). Without
  // these calls the route IS correct from the DB's perspective
  // but the rendered HTML wouldn't pick it up until the tag's
  // revalidate window expired.
  //
  // We need both flavors:
  //   • revalidatePath for the per-page render cache (room/item/
  //     product details + home).
  //   • updateTag(PRODUCT_COUNTS_TAG) for the tag-cached helpers
  //     that drive the home Browse-by-item rail and the
  //     /room/[slug] item rail (coversByItemType /
  //     coversByItemTypeInRoom in lib/products.ts).
  //
  // We narrow revalidatePath to the specific room + item slugs
  // this product actually appears under — invalidating the right
  // pages instead of every room/item page. The select is cheap
  // (single row, indexed PK) compared to the sharp work above.
  const { data: prod } = await supabase
    .from("products")
    .select("room_slugs, item_type")
    .eq("id", productId)
    .single();
  revalidatePath("/");
  revalidatePath(`/product/${productId}`);
  if (prod?.item_type) revalidatePath(`/item/${prod.item_type}`);
  for (const r of prod?.room_slugs ?? []) {
    revalidatePath(`/room/${r}`);
  }
  // revalidateTag (not updateTag) — this is a Route Handler, not a
  // Server Action; updateTag throws here. Fires the same cache-tag
  // invalidation `lib/products#invalidatePublishedCountsCache` does
  // from inside server actions.
  //
  // Second arg "max" pins immediate-purge cache-life. Next 16 deprecated
  // single-arg revalidateTag; "max" is the documented replacement when
  // we want the legacy behavior (purge now, no stale-while-revalidate
  // window).
  revalidateTag(PRODUCT_COUNTS_TAG, "max");

  return NextResponse.json({
    ok: true,
    product_id: productId,
    thumbnail_url: versioned,
    unified_bytes: unified.png.length,
    product_bbox: { w: unified.productWidthPx, h: unified.productHeightPx },
    invalidated: {
      home: true,
      product: `/product/${productId}`,
      item: prod?.item_type ? `/item/${prod.item_type}` : null,
      rooms: prod?.room_slugs ?? [],
    },
  });
}

// 405 on every other method so curl-based callers don't get the
// framework's HTML error page.
export async function GET() {
  return new NextResponse("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
}

/**
 * Compare the incoming `x-cron-secret` header against the value
 * stored in private._app_config.cron_secret (mig 0018) via the
 * SECURITY DEFINER RPC `public.get_cron_secret()` (mig 0036).
 *
 * PostgREST does not expose the `private` schema, so the RPC bridge
 * is necessary. Same cron secret as the existing poll-meshy edge
 * function — single rotation surface.
 */
async function verifyCronSecret(provided: string): Promise<boolean> {
  if (!provided) return false;
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc(
    "get_cron_secret" as never,
  );
  if (error) return false;
  // The mig 0036 RPC returns `text`. supabase-js's generated types
  // don't know about it (we haven't regen'd), so the response is
  // typed `never` — cast through unknown.
  const expected =
    typeof (data as unknown) === "string" ? (data as unknown as string) : "";
  if (!expected) return false;
  // Constant-time compare via length-equal early return + xor accumulator.
  if (expected.length !== provided.length) return false;
  let r = 0;
  for (let i = 0; i < expected.length; i++) {
    r |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return r === 0;
}
