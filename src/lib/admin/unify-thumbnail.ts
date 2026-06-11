/**
 * Wave 2 — sharp pipeline that turns a transparent product cutout PNG
 * into a uniform 1500×1500 white-canvas thumbnail with a soft ground
 * shadow.
 *
 * See docs/wave-2-thumbnail-unify.md for the visual contract +
 * trigger surfaces. This module is the pure "bytes in → bytes out"
 * core; the API route + the backfill script call it.
 *
 * Server-only — sharp is a Node addon, MUST NOT enter any client
 * bundle.
 */
import "server-only";

import sharp from "sharp";

export type UnifyResult = {
  png: Buffer;
  /** Trimmed bbox dimensions of the product before placement.
   *  Useful for logs / future overlays. */
  productWidthPx: number;
  productHeightPx: number;
};

const CANVAS = 1500;
/**
 * Wave 11 — target fraction of the canvas the product bbox fills on
 * its LONGEST side. 0.80 → product spans 1200 px of the 1500 px
 * canvas, leaving 10 % margin per side. Tunable: Jym wanted 80-85 %;
 * we start at the conservative end so long thin products (faucets)
 * don't feel cramped against the card edge.
 *
 * Pre-Wave-11 this was expressed as PADDING_FRACTION = 0.08 (product
 * box 1260 px) — but the resize call had `withoutEnlargement: true`,
 * so cutouts SMALLER than the box were never scaled up. Result:
 * product size on the card depended on whatever pixel size rembg
 * happened to output (60-95 % variance), which is the "products look
 * tiny / cards mostly blank" report this wave fixes.
 */
const TARGET_BBOX_FRACTION = 0.8;
const PRODUCT_BOX = Math.floor(CANVAS * TARGET_BBOX_FRACTION); // 1200

/**
 * Produce the unified thumbnail buffer. Pipeline:
 *
 *   1. Trim transparent padding from the input PNG so we know the
 *      actual product bbox. Anything not a fully-transparent pixel is
 *      kept; the cutout pipeline always outputs a tight transparent
 *      PNG, so this step is mostly a no-op on a few-pixel margin.
 *   2. Resize the trimmed product to fit inside a 1260×1260 box
 *      (PRODUCT_BOX), preserving aspect, no enlargement.
 *   3. Generate an elliptical drop shadow as an SVG → PNG buffer:
 *        • centered on the product's horizontal center
 *        • vertically just below the product's bottom edge
 *        • alpha 15 %, Gaussian blur 30 px
 *        • ellipse width = product width × 0.8 (so the shadow looks
 *          like contact, not a moat)
 *   4. Composite onto a 1500×1500 white canvas: shadow first, then
 *      the product on top.
 */
/**
 * Wave 11 — alpha-aware bbox. sharp's `.trim({background:transparent})`
 * silently no-ops when the cutout's border pixels aren't EXACTLY
 * alpha-0 (rembg sometimes leaves alpha 1-5 noise at the edges) or
 * when the "cutout" is actually an opaque white-background image.
 * Both failure modes produced the Wave 11 bug report: the untrimmed
 * canvas got centered instead of the product, so the product rendered
 * tiny AND off-center with the shadow orphaned at the canvas bottom.
 *
 * This scans the alpha channel directly: bbox = the extent of pixels
 * with alpha > ALPHA_BBOX_THRESHOLD. Deterministic, immune to edge
 * noise. Returns null when the image has no meaningful transparency
 * (fully opaque) — caller falls back to color-based trim for the
 * white-background case.
 */
const ALPHA_BBOX_THRESHOLD = 8;

async function alphaBbox(
  buf: Buffer,
): Promise<{ left: number; top: number; width: number; height: number } | null> {
  const { data, info } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let transparentSeen = false;
  for (let y = 0; y < height; y++) {
    const rowOff = y * width * channels;
    for (let x = 0; x < width; x++) {
      const a = data[rowOff + x * channels + 3];
      if (a <= ALPHA_BBOX_THRESHOLD) {
        transparentSeen = true;
        continue;
      }
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  // No transparency at all → not a transparent cutout; let the caller
  // try color-trim instead. Also bail if somehow nothing is opaque
  // (fully transparent input) — caller's metadata check will throw a
  // clean error.
  if (!transparentSeen || maxX < minX || maxY < minY) return null;
  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

export async function unifyThumbnail(inputPng: Uint8Array): Promise<UnifyResult> {
  // --- 1. tight product bbox (Wave 11: alpha-scan, robust) ---
  const inputBuf = Buffer.from(inputPng);
  const bbox = await alphaBbox(inputBuf);
  const trimmedBuf = bbox
    ? await sharp(inputBuf).extract(bbox).png().toBuffer()
    : // Opaque input (white-background photo masquerading as a cutout).
      // Color-based trim removes the uniform border; threshold 12
      // tolerates JPEG-ish speckle in the white.
      await sharp(inputBuf).trim({ threshold: 12 }).png().toBuffer();
  const trimmedMeta = await sharp(trimmedBuf).metadata();
  if (!trimmedMeta.width || !trimmedMeta.height) {
    throw new Error("unifyThumbnail: post-trim metadata missing width/height");
  }

  // --- 2. scale product so its longest side spans PRODUCT_BOX ---
  // Wave 11: scaling now goes BOTH directions. ratio < 1 shrinks an
  // oversized cutout; ratio > 1 enlarges a small one. Pre-Wave-11 the
  // `withoutEnlargement: true` flag silently skipped the enlarge case,
  // so card-fill depended on rembg's output pixel size. Aspect ratio
  // is always preserved (single uniform ratio on both axes).
  //
  // Upscale quality: lanczos3 kernel (sharp's highest-quality
  // resampler). A 2-3× upscale of a clean cutout reads fine at card
  // size; the alternative — tiny product floating in white — is the
  // worse artifact. Extreme upscales (>4×) only happen on degenerate
  // few-hundred-px cutouts, which the rembg pipeline doesn't produce
  // from operator photos.
  const ratio = Math.min(
    PRODUCT_BOX / trimmedMeta.width,
    PRODUCT_BOX / trimmedMeta.height,
  );
  const productW = Math.max(1, Math.round(trimmedMeta.width * ratio));
  const productH = Math.max(1, Math.round(trimmedMeta.height * ratio));
  const productBuf = await sharp(trimmedBuf)
    .resize(productW, productH, {
      fit: "fill", // exact target — ratio math above already preserved aspect
      kernel: sharp.kernel.lanczos3,
    })
    .png()
    .toBuffer();

  // Placement on the canvas. Center horizontally; vertically center
  // the product but slightly above center so the shadow has room.
  const productLeft = Math.floor((CANVAS - productW) / 2);
  const productTop = Math.floor((CANVAS - productH) / 2);
  const productBottom = productTop + productH;

  // --- 3. shadow buffer ---
  // SVG renders crisply through sharp's input; the ellipse is offset
  // 4 px below the product's bottom so when the blurred mass spreads
  // it sits right under the contact line. ry stays small (14 px) so
  // the soft top of the shadow doesn't bleed into the product itself.
  const shadowSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}">
  <ellipse
    cx="${CANVAS / 2}"
    cy="${productBottom + 4}"
    rx="${Math.round((productW * 0.8) / 2)}"
    ry="14"
    fill="rgba(0,0,0,0.45)" />
</svg>`;
  // Render SVG to PNG, then Gaussian-blur it. Writing it through
  // sharp once gives us the raster; the .blur() call is the actual
  // soft-shadow effect. 30 px stdDeviation matches the spec.
  const shadowBuf = await sharp(Buffer.from(shadowSvg)).blur(30).png().toBuffer();

  // --- 4. composite onto white canvas ---
  // The fill alpha is 0.45 in the SVG but the post-blur perceived
  // density is ~15 % once the kernel spreads — that's the "alpha
  // 15 % + 30-px blur" combo the doc specs.
  const finalBuf = await sharp({
    create: {
      width: CANVAS,
      height: CANVAS,
      channels: 3,
      background: { r: 0xff, g: 0xff, b: 0xff },
    },
  })
    .composite([
      { input: shadowBuf, top: 0, left: 0, blend: "over" },
      { input: productBuf, top: productTop, left: productLeft, blend: "over" },
    ])
    .removeAlpha() // spec: opaque white, no alpha channel
    .png({ compressionLevel: 9 })
    .toBuffer();

  return {
    png: finalBuf,
    productWidthPx: productW,
    productHeightPx: productH,
  };
}
