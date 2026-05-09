"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import ModelViewer from "./ModelViewer";
import ModelViewerErrorBoundary from "./ModelViewerErrorBoundary";
import ModelFallback from "./ModelFallback";

/**
 * Wave 5 (mig 0038) — flat image-pool product gallery.
 *
 * Slide order:
 *   1. <model-viewer> if a GLB is present (always slot 1; GLB is the
 *      hero affordance).
 *   2. Every show_on_storefront image, server-resolved to public-or-
 *      signed URLs, in the order:
 *        • is_primary_thumbnail row first
 *        • then by upload time (created_at ASC)
 *      The customer-card cover (products.thumbnail_url, the unified
 *      PNG of the primary cutout) is implicitly slide 2 because the
 *      operator's primary_thumbnail toggle drives both: rembg's
 *      first-cutout flow auto-promotes is_primary_thumbnail, the
 *      unify route renders the unified PNG into products.thumbnail_url,
 *      and the gallery query orders that same row first.
 *
 * Empty state (no GLB and no show_on_storefront images): a centered
 * camera-icon placeholder with the localized empty caption. Caller
 * may also choose not to mount the gallery at all when the product
 * has no media — both paths are valid.
 *
 * Why client-component: slide selector (click thumbnail / press
 * arrow keys) is interactive, and ModelViewer is already a client
 * component. Keeping the gallery client-side also lets the styled-
 * thumbnail composite swap immediately when ColorSwitcher recolors
 * the model — no round-trip.
 */

type Slide =
  | { kind: "model"; glbUrl: string; alt: string; poster: string | null }
  | { kind: "image"; url: string };

type Props = {
  productName: string;
  /** Mig 0038 — every show_on_storefront image, in display order
   *  (primary thumbnail first, then by upload time). Already
   *  resolved to public-or-signed URLs server-side. */
  galleryUrls: string[];
  /** Optional .glb URL — slot 1 when present. */
  glbUrl: string | null;
  /** products.thumbnail_url (unified.png) — used as the model-viewer
   *  poster. Null OK; model-viewer will render with no poster. */
  primaryThumbnailUrl: string | null;
  /** Hex colour override piped into ModelViewer (from ColorSwitcher). */
  overrideColorHex: string | null;
  /** Fallback caption shown when nothing can be displayed at all. */
  emptyLabel: string;
};

export default function ProductGallery({
  productName,
  galleryUrls,
  glbUrl,
  primaryThumbnailUrl,
  overrideColorHex,
  emptyLabel,
}: Props) {
  const t = useTranslations("product");
  const slides: Slide[] = [];
  if (glbUrl) {
    slides.push({
      kind: "model",
      glbUrl,
      alt: productName,
      poster: primaryThumbnailUrl,
    });
  }
  for (const u of galleryUrls) {
    slides.push({ kind: "image", url: u });
  }

  const [active, setActive] = useState(0);

  if (slides.length === 0) {
    return (
      <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-neutral-100">
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center text-neutral-400">
          <span className="text-3xl">📷</span>
          <span className="px-6 text-sm">{emptyLabel}</span>
        </div>
      </div>
    );
  }

  const current = slides[Math.min(active, slides.length - 1)];

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-square w-full overflow-hidden rounded-lg">
        {current.kind === "model" && (
          // Render-phase / commit-phase errors inside <model-viewer>
          // (Draco decode throw, malformed GLB, WebGL refusal, etc.)
          // are caught here so the rest of the gallery + product page
          // survives. iOS Safari OS-level OOM kills are NOT catchable
          // — those are blocked upstream by lib/admin/glb-budget's
          // checkGlbBudget pre-check at upload time.
          <ModelViewerErrorBoundary
            fallback={
              <ModelFallback thumbnail={current.poster} alt={current.alt} />
            }
          >
            <ModelViewer
              src={current.glbUrl}
              alt={current.alt}
              poster={current.poster}
              overrideColorHex={overrideColorHex}
            />
          </ModelViewerErrorBoundary>
        )}
        {current.kind === "image" && (
          // Background gradient mirrors the legacy "styled-thumbnail"
          // backdrop so cutout PNGs (transparent silhouette) still
          // float on a soft studio look. Real photos / spec sheets
          // (with their own backgrounds) cover the gradient via
          // object-cover; cutouts use object-contain so the silhouette
          // doesn't get cropped.
          <div
            className="relative h-full w-full"
            style={{
              background:
                "linear-gradient(180deg, #f6f6f6 0%, #e7e7e7 60%, #d8d8d8 100%)",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={current.url}
              alt={productName}
              className="h-full w-full object-contain p-3"
            />
          </div>
        )}
        {/* Tiny slide indicator top-right so the visitor knows there
            are more views. Hidden when there's only one slide. */}
        {slides.length > 1 && (
          <div className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white">
            {active + 1} / {slides.length}
          </div>
        )}
      </div>
      {slides.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {slides.map((s, i) => {
            const isActive = i === active;
            return (
              <button
                key={i}
                type="button"
                onClick={() => setActive(i)}
                aria-label={slideAriaLabel(s, i, t)}
                aria-current={isActive ? "true" : undefined}
                className={`relative h-16 w-16 flex-none overflow-hidden rounded border-2 transition ${
                  isActive
                    ? "border-black"
                    : "border-neutral-200 hover:border-neutral-400"
                }`}
              >
                <ThumbPreview slide={s} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function slideAriaLabel(
  s: Slide,
  i: number,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  if (s.kind === "model") return t("galleryViewModel");
  // i is 0-based; the indicator above is 1-based, so display i+1
  // when narrating "scene N".
  return t("galleryViewScene", { n: i + 1 });
}

function ThumbPreview({ slide }: { slide: Slide }) {
  if (slide.kind === "model") {
    // The 3D viewer is heavy — render a placeholder badge instead of
    // mounting ModelViewer N times. Tap the thumb to switch the main
    // viewport over to the live 3D viewer.
    return (
      <div className="flex h-full w-full items-center justify-center bg-neutral-900 text-[10px] font-medium text-white">
        3D
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={slide.url} alt="" className="h-full w-full object-cover" />
  );
}
