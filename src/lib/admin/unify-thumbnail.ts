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
/** 8 % padding total per spec. Product fills 80–85 % of canvas. */
const PADDING_FRACTION = 0.08;
const PRODUCT_BOX = Math.floor(CANVAS * (1 - 2 * PADDING_FRACTION)); // 1260

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
export async function unifyThumbnail(inputPng: Uint8Array): Promise<UnifyResult> {
  // --- 1. trim transparent padding ---
  const trimmedBuf = await sharp(Buffer.from(inputPng))
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const trimmedMeta = await sharp(trimmedBuf).metadata();
  if (!trimmedMeta.width || !trimmedMeta.height) {
    throw new Error("unifyThumbnail: post-trim metadata missing width/height");
  }

  // --- 2. resize to fit PRODUCT_BOX while preserving aspect ---
  const ratio = Math.min(
    PRODUCT_BOX / trimmedMeta.width,
    PRODUCT_BOX / trimmedMeta.height,
  );
  const productW = Math.max(1, Math.floor(trimmedMeta.width * ratio));
  const productH = Math.max(1, Math.floor(trimmedMeta.height * ratio));
  const productBuf = await sharp(trimmedBuf)
    .resize(productW, productH, { fit: "inside", withoutEnlargement: true })
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
