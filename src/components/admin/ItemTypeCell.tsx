"use client";

/**
 * Click the item-type label → opens a popover with the full pill grid
 * of item types. Picking one calls setProductItemTypeAction (which
 * also clears subtype_slug — the old subtype almost certainly doesn't
 * belong to the new item_type, and the DB trigger would reject the
 * update otherwise).
 *
 * "—" (no item type) is also a valid choice; we render it as a
 * dashed pill so the operator can clear without going to /edit.
 */

import { useEffect, useRef, useState } from "react";
import { setProductItemTypeAction } from "@/app/admin/(dashboard)/products/actions";

type Option = { slug: string; label: string };

type Props = {
  productId: string;
  current: string | null;
  options: Option[];
};

export default function ItemTypeCell({ productId, current, options }: Props) {
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

  const currentLabel = current
    ? (options.find((o) => o.slug === current)?.label ?? current)
    : "—";

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded border border-transparent px-1 py-0.5 text-left text-neutral-700 hover:border-neutral-300 hover:bg-neutral-50"
        title="Click to change item type"
      >
        {currentLabel}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 max-h-80 w-72 overflow-auto rounded-md border border-neutral-200 bg-white p-3 shadow-lg">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            Pick item type · changes here clear any subtype
          </div>
          <div className="flex flex-wrap gap-1.5">
            {/* Clear button */}
            <form action={setProductItemTypeAction} className="contents">
              <input type="hidden" name="id" value={productId} />
              <input type="hidden" name="item_type" value="" />
              <button
                type="submit"
                onClick={() => setOpen(false)}
                className={`rounded-full border border-dashed px-2.5 py-1 text-xs transition ${
                  current == null
                    ? "border-black bg-neutral-100"
                    : "border-neutral-300 hover:border-neutral-500"
                }`}
              >
                — clear
              </button>
            </form>
            {options.map((o) => {
              const active = o.slug === current;
              return (
                <form
                  key={o.slug}
                  action={setProductItemTypeAction}
                  className="contents"
                >
                  <input type="hidden" name="id" value={productId} />
                  <input type="hidden" name="item_type" value={o.slug} />
                  <button
                    type="submit"
                    onClick={() => setOpen(false)}
                    className={`rounded-full border px-2.5 py-1 text-xs transition ${
                      active
                        ? "border-black bg-black text-white"
                        : "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-500"
                    }`}
                  >
                    {o.label}
                  </button>
                </form>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
