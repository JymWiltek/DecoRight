"use client";

/**
 * Post-save toast with two action buttons. Triggered by ?fresh=1 in
 * the URL after createProduct redirects. Self-dismissing on close /
 * outside-click; the action buttons navigate.
 *
 * Renders nothing if `productId` is missing or `show=false` — the
 * parent passes `show={sp.fresh === "1"}` so the toast only appears
 * on the first load after creation, never after a normal Save.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Props = {
  show: boolean;
  productId: string;
};

export default function SavedToast({ show, productId }: Props) {
  const [open, setOpen] = useState(show);
  const router = useRouter();

  // If the page is re-rendered with show=false (e.g. after a normal
  // Save), make sure we're closed.
  useEffect(() => {
    setOpen(show);
  }, [show]);

  function close() {
    setOpen(false);
    // Strip ?fresh=1 from the URL so a refresh doesn't re-pop the
    // toast. Next 16's router.replace handles this without scrolling.
    router.replace(`/admin/products/${productId}/edit`, { scroll: false });
  }

  if (!open) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <div className="pointer-events-auto flex w-full max-w-xl items-center justify-between gap-4 rounded-lg border border-neutral-200 bg-white p-4 shadow-lg">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
            ✓
          </span>
          <div>
            <div className="text-sm font-medium text-neutral-900">
              Product created
            </div>
            <div className="text-xs text-neutral-500">
              Saved as draft. Fill in the rest, then publish.
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/products/new"
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:border-black"
            onClick={() => setOpen(false)}
          >
            + Another
          </Link>
          <Link
            href={`/product/${productId}`}
            target="_blank"
            rel="noopener"
            className="rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800"
            onClick={() => setOpen(false)}
          >
            View ↗
          </Link>
          <button
            type="button"
            onClick={close}
            aria-label="Dismiss"
            className="text-neutral-400 hover:text-neutral-700"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
