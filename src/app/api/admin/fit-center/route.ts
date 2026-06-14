/**
 * /api/admin/fit-center — POST { product_id }.
 *
 * Re-frames the product's primary photo so the product is centered and
 * fills ~65% of a 3:4 crop, KEEPING the original scene background, and
 * points products.thumbnail_url at the result. The counterpart to
 * /api/admin/unify-thumbnail (which puts the cutout on a white canvas).
 *
 * How it finds the product in a photo that still has its background:
 * it runs rembg ONCE as a detector on the original photo, reads the
 * cutout's bounding box, then crops the ORIGINAL (background intact).
 * The cutout is never stored or shown — only the original's pixels
 * reach the output. That rembg call spends one provider credit; the
 * operator triggers it manually (Wave 11b's opt-in model), so cost
 * stays controlled.
 *
 * Admin session only (manual button). Always returns JSON.
 */
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getSignedRawUrl, uploadFramedThumbnail } from "@/lib/storage";
import { fitCenterKeepBackground } from "@/lib/admin/fit-center";
import { getDefaultProvider, RemBgProviderUnavailableError } from "@/lib/rembg";
import { QuotaExceededError } from "@/lib/api-usage";
import { PRODUCT_COUNTS_TAG } from "@/lib/products";

export const runtime = "nodejs"; // sharp + rembg provider.
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  const productId =
    body && typeof body === "object" && "product_id" in body
      ? String((body as Record<string, unknown>).product_id ?? "")
      : "";
  if (!UUID_RE.test(productId)) {
    return NextResponse.json({ ok: false, error: "invalid product_id" }, { status: 400 });
  }

  // Resolve the primary image. We crop its ORIGINAL raw bytes (the true
  // scene), so we need raw_image_url — not cutout_image_url.
  const supabase = createServiceRoleClient();
  const { data: img, error: imgErr } = await supabase
    .from("product_images")
    .select("id, raw_image_url, cutout_image_url, skip_cutout")
    .eq("product_id", productId)
    .eq("image_kind", "cutout")
    .eq("state", "cutout_approved")
    .eq("is_primary_thumbnail", true)
    .limit(1)
    .maybeSingle();
  if (imgErr) {
    return NextResponse.json({ ok: false, error: "db error", detail: imgErr.message }, { status: 500 });
  }
  if (!img || !img.raw_image_url) {
    return NextResponse.json({ ok: false, error: "no primary image" }, { status: 404 });
  }

  // Sign the raw scene + fetch its bytes (the pixels we crop).
  let signedUrl: string;
  try {
    signedUrl = await getSignedRawUrl(img.raw_image_url);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "sign failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
  const sceneResp = await fetch(signedUrl, { cache: "no-store" });
  if (!sceneResp.ok) {
    return NextResponse.json(
      { ok: false, error: "scene fetch failed", detail: `${sceneResp.status} ${sceneResp.statusText}` },
      { status: 502 },
    );
  }
  const sceneBytes = new Uint8Array(await sceneResp.arrayBuffer());

  // Detector bytes = a transparent cutout used ONLY to locate the
  // product. If this image already has a REAL rembg cutout
  // (skip_cutout=false), reuse it for free — no second provider credit.
  // Otherwise (Wave 11b skip-cutout default: cutout_image_url is just a
  // copy of the opaque raw) run rembg once as the detector.
  let cutoutBytes: Uint8Array;
  const haveRealCutout = img.skip_cutout === false && !!img.cutout_image_url;
  if (haveRealCutout) {
    const cResp = await fetch(img.cutout_image_url as string, { cache: "no-store" });
    if (!cResp.ok) {
      return NextResponse.json(
        { ok: false, error: "cutout fetch failed", detail: `${cResp.status} ${cResp.statusText}` },
        { status: 502 },
      );
    }
    cutoutBytes = new Uint8Array(await cResp.arrayBuffer());
  } else {
    const provider = getDefaultProvider();
    if (!provider) {
      return NextResponse.json({ ok: false, error: "no rembg provider configured" }, { status: 503 });
    }
    try {
      const result = await provider.run({
        sourceUrl: signedUrl,
        productId,
        productImageId: img.id,
      });
      cutoutBytes = result.bytes;
    } catch (e) {
      if (e instanceof QuotaExceededError) {
        return NextResponse.json({ ok: false, error: "rembg quota exhausted", detail: e.cause }, { status: 429 });
      }
      if (e instanceof RemBgProviderUnavailableError) {
        return NextResponse.json({ ok: false, error: "rembg provider unavailable" }, { status: 503 });
      }
      return NextResponse.json(
        { ok: false, error: "detection failed", detail: e instanceof Error ? e.message : String(e) },
        { status: 502 },
      );
    }
  }

  // Crop the original scene around the detected product.
  let framed;
  try {
    framed = await fitCenterKeepBackground(sceneBytes, cutoutBytes);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "fit-center failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  let publicUrl: string;
  try {
    publicUrl = await uploadFramedThumbnail(productId, new Uint8Array(framed.jpg));
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "upload failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  const versioned = `${publicUrl}?v=${Date.now()}`;
  const { error: updErr } = await supabase
    .from("products")
    .update({ thumbnail_url: versioned })
    .eq("id", productId);
  if (updErr) {
    return NextResponse.json({ ok: false, error: "db update failed", detail: updErr.message }, { status: 500 });
  }

  revalidatePath("/");
  revalidatePath(`/product/${productId}`);
  revalidatePath("/admin");
  // Second arg "max" — Next 16 deprecated single-arg revalidateTag; "max"
  // pins immediate-purge cache-life (same as the unify route does).
  revalidateTag(PRODUCT_COUNTS_TAG, "max");

  return NextResponse.json({
    ok: true,
    thumbnail_url: versioned,
    coverage_pct: framed.coveragePct,
    fallback: framed.fallback,
  });
}
