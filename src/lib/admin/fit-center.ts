/**
 * Fit-&-center the product inside a 3:4 frame WITHOUT removing the
 * background. The counterpart to unify-thumbnail.ts (which composites a
 * cutout onto a white canvas): this one CROPS the original scene photo
 * so the product sits centered and fills ~65% of the frame, keeping the
 * surrounding scene intact. Jym's brief: "不要删背景, 原装场景图很好;
 * 但要自动把产品在框里居中 + 占框 60-70%".
 *
 * It needs to know WHERE the product is in a photo that still has its
 * background. We get that by running rembg purely as a DETECTOR (the
 * route does that) and reading the cutout's alpha bounding box — then
 * we map that box onto the original scene and crop. The cutout is
 * discarded; only the original scene's pixels ever reach the output.
 *
 * Server-only — sharp is a Node addon.
 */
import "server-only";

import sharp from "sharp";
import { alphaBbox } from "./unify-thumbnail";

/** 3:4 portrait to match the storefront ProductCard frame (aspect-[3/4],
 *  object-cover) so the card never has to re-crop our result. */
const OUT_W = 1200;
const OUT_H = 1600;
const OUT_AR = OUT_W / OUT_H; // 0.75
/** Target fraction of the framed crop the product bbox should fill. */
const TARGET = 0.65;

export type FitCenterResult = {
  jpg: Buffer;
  /** Product coverage in the output frame (%), for logs / UI. */
  coveragePct: number;
  /** True when bbox detection failed and we fell back to a centered
   *  crop (still keeps background, just not product-aware). */
  fallback: boolean;
};

/**
 * @param sceneBytes  the ORIGINAL scene photo (with background)
 * @param cutoutBytes a transparent rembg cutout of the SAME photo, used
 *                    only to locate the product. May be from a different
 *                    pixel size than the scene — we rescale the box.
 */
export async function fitCenterKeepBackground(
  sceneBytes: Uint8Array,
  cutoutBytes: Uint8Array,
): Promise<FitCenterResult> {
  const sceneBuf = Buffer.from(sceneBytes);
  const sceneMeta = await sharp(sceneBuf).metadata();
  const W = sceneMeta.width;
  const H = sceneMeta.height;
  if (!W || !H) {
    throw new Error("fit-center: scene metadata missing width/height");
  }

  // Product bbox from the detection cutout, mapped into scene pixels.
  const cutoutBuf = Buffer.from(cutoutBytes);
  const cbox = await alphaBbox(cutoutBuf);
  const cMeta = await sharp(cutoutBuf).metadata();
  let box: { left: number; top: number; width: number; height: number };
  let fallback = false;
  if (cbox && cMeta.width && cMeta.height) {
    const sx = W / cMeta.width;
    const sy = H / cMeta.height;
    box = {
      left: cbox.left * sx,
      top: cbox.top * sy,
      width: cbox.width * sx,
      height: cbox.height * sy,
    };
  } else {
    // Detection produced no transparency (rembg failed / opaque output).
    // Fall back to a centered crop covering ~TARGET of the scene so we
    // still return a sane framed image instead of throwing.
    fallback = true;
    const side = Math.min(W, H) * TARGET;
    box = { left: (W - side) / 2, top: (H - side) / 2, width: side, height: side };
  }

  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;

  // 3:4 crop sized so the product occupies ~TARGET of it on its tighter
  // axis. Take the max so neither axis exceeds TARGET.
  let cropH = Math.max(box.height / TARGET, box.width / TARGET / OUT_AR);
  let cropW = cropH * OUT_AR;
  // Fit within the scene, preserving 3:4. If the ideal crop is bigger
  // than the photo (product already large), scale down — product ends
  // up > TARGET, but that's the honest limit: we won't invent scenery.
  const fit = Math.min(1, W / cropW, H / cropH);
  cropW = Math.max(1, Math.floor(cropW * fit));
  cropH = Math.max(1, Math.floor(cropH * fit));

  // Center on the product, then clamp the window inside the photo.
  let left = Math.round(cx - cropW / 2);
  let top = Math.round(cy - cropH / 2);
  left = Math.max(0, Math.min(left, W - cropW));
  top = Math.max(0, Math.min(top, H - cropH));

  const jpg = await sharp(sceneBuf)
    .extract({ left, top, width: cropW, height: cropH })
    .resize(OUT_W, OUT_H, { fit: "cover", kernel: sharp.kernel.lanczos3 })
    .jpeg({ quality: 86 })
    .toBuffer();

  const coveragePct = Math.round(
    Math.max(box.width / cropW, box.height / cropH) * 100,
  );
  return { jpg, coveragePct, fallback };
}
