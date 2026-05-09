"use client";

/**
 * Real-photo carousel below the main product gallery (Wave 4).
 *
 * Why a separate component (vs. extending ProductGallery):
 *   • Different interaction model — the main gallery's thumbnails
 *     swap the active slide IN-LINE; this strip opens a lightbox
 *     overlay instead. Mixing the two paths in one component would
 *     mean a runtime mode-switch on every thumbnail click.
 *   • Different inputs — main gallery is GLB-or-cutout-or-scene;
 *     this is just real product photos straight from operator
 *     uploads. Filter happens server-side (image_kind='real_photo').
 *   • Different visual rhythm — operators upload 3-4 real photos,
 *     they're meant to be eyeballed quickly without disrupting
 *     the 3D viewer above. A horizontal scroll strip with thumbs
 *     is the right shape; the main gallery's tall-aspect slides
 *     would dominate the layout if real photos were wired in there.
 *
 * Lightbox: minimal — full-viewport overlay with the image
 * object-contained, click anywhere outside the image (or press
 * Escape) to close. No keyboard arrow nav between photos in this
 * pass; if operators want that we'll add it after seeing real
 * usage. The strip itself supports horizontal scroll on mobile
 * via overflow-x-auto.
 *
 * Empty state: render nothing. The product page should not allocate
 * vertical space for an empty real-photo section.
 */

import { useEffect, useState } from "react";

type Props = {
  /** Pre-resolved (signed) image URLs in display order. */
  urls: string[];
  /** A11y label for each thumbnail + lightbox image. Same string
   *  used for all of them — the operator can't title each photo
   *  individually yet. */
  alt: string;
};

export default function RealPhotoStrip({ urls, alt }: Props) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  // Escape closes the lightbox. Listen only while open so we don't
  // capture Escape for the rest of the page when the lightbox isn't
  // mounted (some operator hot-keys live there).
  useEffect(() => {
    if (openIdx === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenIdx(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openIdx]);

  if (urls.length === 0) return null;

  return (
    <div className="mt-6">
      <div
        className="
          flex gap-3 overflow-x-auto
          [scrollbar-width:thin]
        "
        role="list"
        aria-label="Real product photos"
      >
        {urls.map((u, i) => (
          <button
            key={u}
            type="button"
            role="listitem"
            onClick={() => setOpenIdx(i)}
            className="
              relative h-28 w-28 flex-none
              overflow-hidden rounded-md border border-neutral-200
              bg-neutral-50 transition
              hover:border-neutral-500
              focus-visible:outline focus-visible:outline-2 focus-visible:outline-black
            "
            aria-label={`${alt} — photo ${i + 1} of ${urls.length}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={u}
              alt={alt}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          </button>
        ))}
      </div>

      {openIdx !== null && (
        <div
          // Click anywhere on the overlay closes; the inner image is
          // a separate stop-propagation target so clicks ON it don't
          // dismiss. Standard lightbox affordance.
          onClick={() => setOpenIdx(null)}
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          className="
            fixed inset-0 z-50 flex items-center justify-center
            bg-black/85 p-4
            animate-in fade-in
          "
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={urls[openIdx]}
            alt={alt}
            className="max-h-full max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={() => setOpenIdx(null)}
            className="
              absolute right-4 top-4
              flex h-9 w-9 items-center justify-center
              rounded-full bg-white/15 text-2xl text-white
              hover:bg-white/25
              focus-visible:outline focus-visible:outline-2 focus-visible:outline-white
            "
            aria-label="Close photo"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
