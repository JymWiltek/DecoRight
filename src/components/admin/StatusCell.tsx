"use client";

/**
 * Inline status badge that opens a popover of the four status pills
 * on click. Picking a pill is only a *pending* choice — nothing
 * writes until the operator hits Save. Cancel (or Escape, or
 * clicking outside) discards the pending choice.
 *
 * Why explicit Save/Cancel:
 *   Auto-saving on pill-click is too dangerous — one mis-click
 *   silently publishes or archives a product. Every inline edit
 *   on this page now commits only on explicit Save. The cell's
 *   resting appearance is unchanged, but the popover footer has
 *   two buttons.
 *
 * Why no nested <form>: the /admin table is wrapped in
 * <form id="bulk-form"> for bulk ops; nesting forms is invalid
 * HTML and the inner submit is dropped. We call the server action
 * directly with a manually-built FormData — works because React
 * 19 server actions are plain async functions.
 */

import { useEffect, useRef, useState, useTransition } from "react";
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
  const [pending, startTransition] = useTransition();
  // Pending = the pill the user clicked but hasn't saved yet.
  // Starts at `current` every time the popover opens, so Cancel
  // returns to the row's actual DB state.
  const [draft, setDraft] = useState<ProductStatus>(current);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(current); // reset whenever opening so Cancel works.
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
  }, [open, current]);

  function save() {
    if (draft === current) {
      setOpen(false);
      return;
    }
    setOpen(false);
    const fd = new FormData();
    fd.set("id", productId);
    fd.set("status", draft);
    startTransition(async () => {
      await setProductStatusAction(fd);
    });
  }

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={pending}
        className={`rounded-full px-2 py-0.5 text-xs transition hover:opacity-80 ${STATUS_STYLES[current]} ${
          pending ? "opacity-50" : ""
        }`}
        title="Click to change status"
      >
        {PRODUCT_STATUS_LABELS[current]}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 flex flex-col gap-2 rounded-md border border-neutral-200 bg-white p-2 shadow-lg">
          <div className="flex flex-col gap-1">
            {PRODUCT_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setDraft(s)}
                className={`whitespace-nowrap rounded-full px-3 py-1 text-left text-xs transition ${
                  s === draft
                    ? `${STATUS_STYLES[s]} font-semibold ring-1 ring-black`
                    : `${STATUS_STYLES[s]} hover:opacity-80`
                }`}
              >
                {PRODUCT_STATUS_LABELS[s]}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-end gap-1 border-t border-neutral-200 pt-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded border border-neutral-300 bg-white px-2 py-0.5 text-[11px] text-neutral-700 hover:border-neutral-500"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={draft === current}
              className={`rounded px-2 py-0.5 text-[11px] font-medium text-white ${
                draft === current
                  ? "bg-neutral-300"
                  : "bg-black hover:bg-neutral-800"
              }`}
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
