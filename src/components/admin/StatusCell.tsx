"use client";

/**
 * Inline status badge that opens a popover of the four status pills
 * on click. Submits the chosen status via setProductStatusAction
 * (single-column update, doesn't touch any other field).
 *
 * Why a popover and not a <select>: a 4-state badge needs to read
 * "draft / published / archived / link_broken" instantly; a native
 * select hides the options behind a chevron. The popover also lets
 * us keep the colored chips (emerald/amber/red) so the operator
 * sees the same visual at-rest as in the table.
 */

import { useEffect, useRef, useState } from "react";
import { setProductStatusAction } from "@/app/admin/(dashboard)/products/actions";
import {
  PRODUCT_STATUSES,
  type ProductStatus,
} from "@/lib/constants/enums";
import { PRODUCT_STATUS_LABELS } from "@/lib/constants/enum-labels";

const STATUS_STYLES: Record<ProductStatus, string> = {
  draft: "bg-neutral-100 text-neutral-700",
  published: "bg-emerald-100 text-emerald-700",
  archived: "bg-amber-100 text-amber-800",
  link_broken: "bg-red-100 text-red-700",
};

type Props = {
  productId: string;
  current: ProductStatus;
};

export default function StatusCell({ productId, current }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`rounded-full px-2 py-0.5 text-xs transition hover:opacity-80 ${STATUS_STYLES[current]}`}
        title="Click to change status"
      >
        {PRODUCT_STATUS_LABELS[current]}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 flex flex-col gap-1 rounded-md border border-neutral-200 bg-white p-2 shadow-lg">
          {PRODUCT_STATUSES.map((s) => (
            <form
              key={s}
              action={setProductStatusAction}
              className="contents"
            >
              <input type="hidden" name="id" value={productId} />
              <input type="hidden" name="status" value={s} />
              <button
                type="submit"
                onClick={() => setOpen(false)}
                className={`whitespace-nowrap rounded-full px-3 py-1 text-left text-xs transition ${
                  s === current
                    ? `${STATUS_STYLES[s]} font-semibold ring-1 ring-black`
                    : `${STATUS_STYLES[s]} hover:opacity-80`
                }`}
              >
                {PRODUCT_STATUS_LABELS[s]}
              </button>
            </form>
          ))}
        </div>
      )}
    </div>
  );
}
