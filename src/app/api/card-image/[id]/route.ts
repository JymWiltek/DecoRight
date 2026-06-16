/**
 * /api/card-image/[id] — masonry card thumbnail with white borders
 * trimmed off. Fetches the product's thumbnail_url and runs
 * sharp.trim() so white-bordered spec drawings fill their masonry tile
 * instead of showing ugly padding. trim() is a NO-OP on real scene
 * photos (non-uniform edges), so it's safe to run on every card.
 *
 * Public (products are public). Strong cache headers + a ?v= the card
 * passes (derived from thumbnail_url's version) make repeat loads free.
 * On any failure we redirect to the original thumbnail — never a broken
 * image.
 */
import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { createServiceRoleClient } from "@/lib/supabase/service";

export const runtime = "nodejs"; // sharp is a Node addon.
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRIM_THRESHOLD = 11; // tolerate JPEG speckle in white borders
const WHITE_TRIM_THRESHOLD = 22; // 2nd pass: explicit white, a touch more tolerant

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { data: product } = await supabase
    .from("products")
    .select("thumbnail_url")
    .eq("id", id)
    .maybeSingle();
  const src = product?.thumbnail_url ?? null;
  if (!src) return NextResponse.json({ error: "no thumbnail" }, { status: 404 });

  // Fetch the current thumbnail bytes.
  let bytes: Buffer;
  try {
    const resp = await fetch(src, { cache: "no-store" });
    if (!resp.ok) return NextResponse.redirect(src, 302);
    bytes = Buffer.from(await resp.arrayBuffer());
  } catch {
    return NextResponse.redirect(src, 302);
  }

  // Trim uniform borders so the product fills the masonry tile.
  //   Pass 1 — trim against the TOP-LEFT pixel (sharp's default). Handles
  //            any uniform border colour: white spec sheets, white scene
  //            cutouts, black-flattened cutouts, etc.
  //   Pass 2 — opaque images only: explicitly trim a WHITE border that
  //            pass 1 missed. This is the "product offset to a corner"
  //            case: when the product touches the top-left, pass 1's
  //            reference pixel IS the product, so it leaves the white on
  //            the other three sides. Real scene photos have non-white
  //            edges, so pass 2 is a no-op on them.
  // Transparent cutouts (alpha/PNG) skip pass 2 — a white pass could
  // nibble a white-silhouette product; pass 1 is alpha-aware and enough.
  let out: Buffer;
  let contentType = "image/jpeg";
  try {
    const meta = await sharp(bytes).metadata();
    const isAlpha = Boolean(meta.hasAlpha) || meta.format === "png";
    let work = await sharp(bytes, { failOn: "none" })
      .trim({ threshold: TRIM_THRESHOLD })
      .toBuffer();
    if (!isAlpha) {
      try {
        work = await sharp(work)
          .trim({ background: "#ffffff", threshold: WHITE_TRIM_THRESHOLD })
          .toBuffer();
      } catch {
        // sharp.trim throws if the image is uniformly white — keep pass 1.
      }
    }
    if (isAlpha) {
      out = await sharp(work).png({ compressionLevel: 9 }).toBuffer();
      contentType = "image/png";
    } else {
      out = await sharp(work).jpeg({ quality: 82 }).toBuffer();
      contentType = "image/jpeg";
    }
  } catch {
    // sharp couldn't process it — serve the original untouched.
    return NextResponse.redirect(src, 302);
  }

  return new NextResponse(new Uint8Array(out), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      // Card src carries ?v=<thumbnail version> → safe to cache hard.
      "Cache-Control": "public, max-age=86400, s-maxage=31536000, immutable",
    },
  });
}
