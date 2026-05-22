import "server-only";

import sharp from "sharp";

/**
 * Wave 8 — low-contrast cutout shrink detector.
 *
 * rembg occasionally mistakes a light product (white / grey / beige /
 * pale wood / chrome) for the white-ish background and eats the
 * product's edges. The resulting cutout PNG has the real product
 * occupying only a small fraction of the canvas; once the unify step
 * centers it on a 1500×1500 white canvas the storefront card looks
 * like a stamp in a sea of whitespace.
 *
 * This module MEASURES that — it does not fix the cutout. We compute
 * the non-transparent bounding box as a fraction of the full canvas
 * so the caller (pipeline.ts) can tag the row with a soft warning.
 *
 * Server-only — sharp is a Node addon and must never enter a client
 * bundle.
 */

/** Below this fraction the cutout is flagged. Hard-coded per Jym's
 *  spec; he tunes it later. 0.5 = "product should fill at least half
 *  the canvas area". */
export const BBOX_WARN_THRESHOLD = 0.5;

export type BboxResult = {
  /** Non-transparent bbox area ÷ full canvas area, range [0,1]. */
  ratio: number;
  /** 'bbox_too_small' when ratio < BBOX_WARN_THRESHOLD, else null. */
  warning: "bbox_too_small" | null;
};

/**
 * Measure what fraction of the cutout canvas the actual (non-
 * transparent) product occupies.
 *
 * Implementation: sharp's `.trim()` with a transparent background
 * strips fully-transparent borders, leaving the tight bounding
 * rectangle of all non-transparent pixels. bbox area = trimmed
 * width × height; canvas area = original width × height.
 *
 * Edge cases:
 *   • Fully-transparent input (rembg ate EVERYTHING): sharp throws
 *     "Input image is entirely blank" on trim → ratio 0 + warning.
 *   • Non-transparent input (no alpha / opaque): trim is a near
 *     no-op → ratio ≈ 1, no warning.
 *   • Any sharp failure we can't categorize → ratio 1 + no warning
 *     (fail open: never block on a measurement error; the worst case
 *     is a missing warning, not a false alarm).
 */
export async function computeCutoutBbox(
  png: Uint8Array,
): Promise<BboxResult> {
  try {
    const base = sharp(Buffer.from(png));
    const meta = await base.metadata();
    if (!meta.width || !meta.height) {
      return { ratio: 1, warning: null };
    }
    const canvasArea = meta.width * meta.height;

    let trimmedW: number;
    let trimmedH: number;
    try {
      // Re-create the sharp instance — a metadata() read consumes the
      // pipeline, so trim needs a fresh one.
      const trimmed = await sharp(Buffer.from(png))
        .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .toBuffer({ resolveWithObject: true });
      trimmedW = trimmed.info.width;
      trimmedH = trimmed.info.height;
    } catch (e) {
      // sharp throws when the image is entirely blank (fully
      // transparent) — that's the worst shrink possible: the product
      // is gone. Treat as ratio 0 → warning.
      const msg = e instanceof Error ? e.message : String(e);
      if (/blank/i.test(msg)) {
        return { ratio: 0, warning: "bbox_too_small" };
      }
      throw e;
    }

    const ratio = Math.min(1, (trimmedW * trimmedH) / canvasArea);
    return {
      ratio,
      warning: ratio < BBOX_WARN_THRESHOLD ? "bbox_too_small" : null,
    };
  } catch {
    // Fail open: a measurement error must never block the pipeline or
    // raise a false warning. No warning, ratio 1.
    return { ratio: 1, warning: null };
  }
}
