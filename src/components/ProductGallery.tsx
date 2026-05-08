"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import ModelViewer from "./ModelViewer";
import ModelViewerErrorBoundary from "./ModelViewerErrorBoundary";
import ModelFallback from "./ModelFallback";

/**
 * Product gallery — main image priority is "3D first, photo fallback":
 *
 *   - With GLB:  slide 1 is the <model-viewer>. The styled-thumbnail
 *                cutout is NOT shown — once we can show the real 3D
 *                model, the gradient-composited 2D fallback is just
 *                noise. Original scene photos still follow as slides
 *                2+ for context.
 *
 *   - Without GLB:  slide 1 is the styled-thumbnail (the cutout
 *                composited on a soft grey gradient — same look as
 *                the catalog tile so what was clicked is what shows).
 *                Silent degradation: the visitor never learns there's
 *                supposed to be a 3D viewer here.
 *
 *   - In both cases, original scene photos (the raw uploads) follow
 *                as the trailing slides for in-context shots.
 *
 * No slides → caller should not even mount this; it returns null.
 *
 * Why client-component: the slide selector is interactive (click a
 * thumbnail / press arrow keys), and ModelViewer is already a client
 * component. Keeping the gallery client-side also lets the styled-
 * thumbnail composite swap immediately when ColorSwitcher recolors
 * the model — no round-trip.
 */

type Slide =
  | { kind: "styled-thumbnail"; cutoutUrl: string }
  | { kind: "model"; glbUrl: string; alt: string; poster: string | null }
  | { kind: "original"; rawUrl: string };

type Props = {
  productName: string;
  /** Primary cutout (transparent PNG) — slide 1's source. Null if
   *  the product has no approved primary image yet. */
  primaryCutoutUrl: string | null;
  /** Optional .glb — slide 2 if present. */
  glbUrl: string | null;
  /** Signed raw-image URLs for the non-primary photos — slides 3+.
   *  Empty array = no extra scene photos. */
  originalRawUrls: string[];
  /** Hex colour override piped into ModelViewer (from ColorSwitcher). */
  overrideColorHex: string | null;
  /** Fallback caption shown when nothing can be displayed at all. */
  emptyLabel: string;
};

export default function ProductGallery({
  productName,
  primaryCutoutUrl,
  glbUrl,
  originalRawUrls,
  overrideColorHex,
  emptyLabel,
}: Props) {
  const t = useTranslations("product");
  // 3D wins the main slot when present. The styled-thumbnail only
  // appears as the silent fallback when there's no GLB — we never
  // want to show both because the cutout-on-gradient composite is
  // a stand-in for the 3D viewer, not a peer of it.
  const slides: Slide[] = [];
  if (glbUrl) {
    slides.push({
      kind: "model",
      glbUrl,
      alt: productName,
      poster: primaryCutoutUrl,
    });
  } else if (primaryCutoutUrl) {
    slides.push({ kind: "styled-thumbnail", cutoutUrl: primaryCutoutUrl });
  }
  for (const r of originalRawUrls) {
    slides.push({ kind: "original", rawUrl: r });
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
        {current.kind === "styled-thumbnail" && (
          // Soft top-to-bottom grey gradient is the "studio backdrop"
          // we composite the cutout onto. The cutout already has a
          // transparent background (rembg output), so object-contain
          // shows the product floating on the gradient — matches
          // SPEC 2 slide #1.
          <div
            className="relative h-full w-full"
            style={{
              background:
                "linear-gradient(180deg, #f6f6f6 0%, #e7e7e7 60%, #d8d8d8 100%)",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={current.cutoutUrl}
              alt={productName}
              className="h-full w-full object-contain p-6"
            />
          </div>
        )}
        {current.kind === "model" && (
          // Render-phase / commit-phase errors inside <model-viewer>
          // (Draco decode throw, malformed GLB, WebGL refusal, etc.)
          // are caught here so the rest of the gallery + product page
          // survives. iOS Safari OS-level OOM kills are NOT catchable
          // — those are blocked upstream by lib/admin/compress-glb's
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
        {current.kind === "original" && (
          // Original scene photo — full-bleed, no gradient backdrop.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={current.rawUrl}
            alt={t("gallerySceneAlt", { name: productName })}
            className="h-full w-full object-cover"
          />
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
  if (s.kind === "styled-thumbnail") return t("galleryViewMain");
  if (s.kind === "model") return t("galleryViewModel");
  return t("galleryViewScene", { n: i });
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
  if (slide.kind === "styled-thumbnail") {
    return (
      <div
        className="relative h-full w-full"
        style={{
          background:
            "linear-gradient(180deg, #f6f6f6 0%, #d8d8d8 100%)",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={slide.cutoutUrl}
          alt=""
          className="h-full w-full object-contain p-1"
        />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={slide.rawUrl} alt="" className="h-full w-full object-cover" />
  );
}
