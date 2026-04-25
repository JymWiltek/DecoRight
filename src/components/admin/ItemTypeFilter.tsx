"use client";

/**
 * Item Type filter for the /admin product list. Sits in the toolbar
 * next to the Status chips. Behaves as a single-select dropdown:
 *
 *   - Closed: a button showing "Item type: All" (or "Faucet · 水龙头 · Pili"
 *     when one is picked, single-line so the toolbar stays compact).
 *   - Open: a popover with a tri-lingual chip grid identical in shape
 *     to the taxonomy admin chips (TriLingualLabel). Three special
 *     pills always sit on top:
 *       * "All" — clears ?type=
 *       * "(untyped)" — sets ?type=__none__, surfaces NULL item_type
 *         rows so they can be cleaned up
 *
 * URL contract:
 *   ?type=<slug>           → filter to that slug
 *   ?type=__none__         → filter to item_type IS NULL
 *   (param missing)        → no filter
 *
 * Why a custom popover and not <select>:
 *   <select> can't render multi-line tri-lingual options, and it
 *   wouldn't visually match the taxonomy chips Jym picked in task 1.
 *   The popover reuses TriLingualLabel so the look is identical.
 *
 * Why useRouter().push and not a <Link>:
 *   Picking is one click — we want to commit the filter immediately
 *   on click (no Save button), the same way Status chips do. Closing
 *   the popover happens before the push so the next paint already
 *   reflects "popover closed, filter applied".
 *
 * Counts: each chip shows `(N)` when N > 0 — same convention as the
 *   Status chips above. Counts are computed on the server from the
 *   currently-shown set, so they answer "what would I see if I
 *   clicked this?" within the current search/status filter.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import TriLingualLabel from "./TriLingualLabel";

export const ITEM_TYPE_NONE_PARAM = "__none__";

export type ItemTypeFilterOption = {
  slug: string;
  label_en: string;
  label_zh: string | null;
  label_ms: string | null;
};

type Props = {
  /** All item types from the taxonomy, alpha-sorted (caller's choice). */
  options: ItemTypeFilterOption[];
  /** Currently active filter, read from ?type= by the page component:
   *   - undefined → no filter ("All")
   *   - ITEM_TYPE_NONE_PARAM → NULL item_type filter
   *   - any other string → that slug */
  current?: string;
  /** slug → count of products in the currently-rendered list with that
   *  item_type. Includes the "__none__" key for NULL rows. */
  counts: Record<string, number>;
};

export default function ItemTypeFilter({ options, current, counts }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside-click / Escape, same pattern as ItemTypeCell.
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

  function applyFilter(next: string | undefined) {
    setOpen(false);
    const params = new URLSearchParams(sp.toString());
    if (next == null) params.delete("type");
    else params.set("type", next);
    const qs = params.toString();
    router.push(qs ? `/admin?${qs}` : "/admin");
  }

  // Compose the button label. Single-line so the toolbar stays one row
  // even when a long item type is picked.
  let buttonLabel: React.ReactNode;
  if (current === ITEM_TYPE_NONE_PARAM) {
    buttonLabel = (
      <span>
        Item type: <span className="font-medium">(untyped)</span>
      </span>
    );
  } else if (current) {
    const opt = options.find((o) => o.slug === current);
    if (opt) {
      const parts = [opt.label_en, opt.label_zh, opt.label_ms]
        .filter(Boolean)
        .join(" · ");
      buttonLabel = (
        <span>
          Item type: <span className="font-medium">{parts}</span>
        </span>
      );
    } else {
      buttonLabel = (
        <span>
          Item type: <span className="font-medium">{current}</span>
        </span>
      );
    }
  } else {
    buttonLabel = (
      <span>
        Item type: <span className="font-medium">All</span>
      </span>
    );
  }

  const isFiltered = current !== undefined;

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs transition ${
          isFiltered
            ? "border-black bg-neutral-100 text-neutral-900"
            : "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-500"
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {buttonLabel}
        <span aria-hidden className="ml-1 text-[10px]">
          ▾
        </span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-[28rem] max-w-[calc(100vw-2rem)] rounded-md border border-neutral-200 bg-white shadow-lg">
          <div className="max-h-[28rem] overflow-auto p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
              Filter by item type · single select
            </div>

            {/* The two control pills (All + untyped) sit on their own
                row above the taxonomy grid so they're easy to find and
                don't get visually mixed in with item-type chips. */}
            <div className="mb-3 flex flex-wrap gap-1.5 border-b border-neutral-100 pb-3">
              <button
                type="button"
                onClick={() => applyFilter(undefined)}
                className={`rounded-md border px-3 py-1.5 text-xs transition ${
                  current === undefined
                    ? "border-black bg-black text-white"
                    : "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-500"
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => applyFilter(ITEM_TYPE_NONE_PARAM)}
                className={`rounded-md border border-dashed px-3 py-1.5 text-xs transition ${
                  current === ITEM_TYPE_NONE_PARAM
                    ? "border-black bg-neutral-100 text-neutral-900"
                    : "border-neutral-300 text-neutral-700 hover:border-neutral-500"
                }`}
                title="Products with no item_type set yet"
              >
                (untyped)
                {counts[ITEM_TYPE_NONE_PARAM] ? (
                  <span className="ml-1 text-neutral-500">
                    ({counts[ITEM_TYPE_NONE_PARAM]})
                  </span>
                ) : null}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              {options.map((o) => {
                const active = o.slug === current;
                const n = counts[o.slug] ?? 0;
                return (
                  <button
                    key={o.slug}
                    type="button"
                    onClick={() => applyFilter(o.slug)}
                    className={`flex items-start justify-between gap-2 rounded-md border px-3 py-2 text-left transition ${
                      active
                        ? "border-black bg-black text-white"
                        : "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-500"
                    }`}
                  >
                    <TriLingualLabel
                      en={o.label_en}
                      zh={o.label_zh}
                      ms={o.label_ms}
                    />
                    {n > 0 && (
                      <span
                        className={`mt-0.5 shrink-0 text-[11px] ${
                          active ? "text-white/80" : "text-neutral-500"
                        }`}
                      >
                        ({n})
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
