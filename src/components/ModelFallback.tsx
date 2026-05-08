"use client";

/**
 * Static fallback shown in place of <model-viewer> when its subtree
 * throws inside ModelViewerErrorBoundary.
 *
 * Look:
 *   • Fills the same aspect-square slot the model-viewer would —
 *     surrounding gallery layout doesn't shift.
 *   • Background uses the same soft top-to-bottom grey gradient as
 *     the styled-thumbnail slide, so a reader landing on a fallback
 *     gets the same studio-backdrop visual language as if the
 *     product simply had no GLB. Conscious choice: rather than a
 *     red error banner that screams "something broke", we
 *     gracefully degrade to the cutout-on-gradient look. The visitor
 *     still sees the product; they just don't get the 3D rotate.
 *   • One quiet caption row across the bottom explains why there's
 *     no 3D, in the active locale.
 *
 * Inputs:
 *   • thumbnail: URL of the cutout PNG to composite. Mirrors what
 *     ProductGallery passes as `poster` to the model-viewer.
 *     If null we render an icon instead of the image.
 *   • alt: a11y label for the cutout image.
 *
 * Why a separate component (vs. inlining in the boundary):
 *   • Keeps i18n (useTranslations) in a hooks-friendly function
 *     component — error boundaries are class components and can't
 *     call hooks themselves.
 *   • Lets us re-use this same fallback elsewhere should the
 *     pattern grow (e.g. AR launcher errors, color-switcher
 *     boundary, etc.).
 */

import { useTranslations } from "next-intl";

type Props = {
  thumbnail: string | null;
  alt: string;
};

export default function ModelFallback({ thumbnail, alt }: Props) {
  const t = useTranslations("product");
  return (
    <div
      className="relative h-full w-full"
      style={{
        background:
          "linear-gradient(180deg, #f6f6f6 0%, #e7e7e7 60%, #d8d8d8 100%)",
      }}
      role="img"
      aria-label={t("modelUnavailable")}
    >
      {thumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbnail}
          alt={alt}
          className="h-full w-full object-contain p-6"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-3xl text-neutral-400">
          📦
        </div>
      )}
      {/*
        Caption strip. Black/70 background gives WCAG AA contrast on
        any thumbnail behind it; positioned at the bottom so the
        product image still reads. No retry button: a retry would
        just blow up the same way (the underlying mesh / texture
        load is the cause), which would erode trust faster than
        a quiet static caption.
      */}
      <div className="absolute inset-x-0 bottom-0 bg-black/70 px-3 py-1.5 text-center text-xs text-white">
        {t("modelUnavailable")}
      </div>
    </div>
  );
}
