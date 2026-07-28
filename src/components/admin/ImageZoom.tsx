"use client";

import { useState } from "react";

/**
 * Click-to-zoom lightbox (PB #33 item 4). Reuses the established admin overlay
 * pattern (fixed inset-0 · z-high · bg-black/… backdrop) that BulkAiFlow /
 * ConsumerAuthModal already use — no new modal system. Click the trigger → the
 * full image in a centered modal; click the backdrop or the × to close. No
 * hover affordance (touch devices have none) — the whole trigger is tappable.
 *
 * `children` overrides the default <img> trigger (e.g. the list tile which
 * already renders its own thumbnail); otherwise it renders `src` as the trigger.
 */
export default function ImageZoom({
  src,
  alt = "",
  triggerClassName,
  children,
}: {
  src: string;
  alt?: string;
  triggerClassName?: string;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={triggerClassName}
        title="点击放大"
        aria-label="点击放大图片"
      >
        {children ?? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={alt} className="h-full w-full object-cover" />
        )}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-lg leading-none text-neutral-800 shadow hover:bg-white"
            aria-label="关闭"
          >
            ✕
          </button>
          {/* Stop propagation so clicking the image itself doesn't close. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] max-w-[90vw] rounded object-contain shadow-2xl"
          />
        </div>
      )}
    </>
  );
}
