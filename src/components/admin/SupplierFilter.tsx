"use client";

/**
 * PB2 item 2 — Supplier / retailer filter for the /admin product list.
 * Sits in the toolbar next to the Item Type filter. Single-select popover:
 *
 *   ?supplier=<id>   → show only products linked to that supplier
 *   (param missing)  → no filter ("All")
 *
 * Its main job is letting the operator pick the internal "Others" marker to
 * surface every product that lacks a real sales channel, but it lists every
 * supplier for symmetry. Mirrors ItemTypeFilter's interaction (popover +
 * router.push, close on outside-click / Escape) so the toolbar stays
 * consistent; suppliers have no tri-lingual labels so it renders plain names.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export type SupplierFilterOption = { id: string; name: string };

type Props = {
  options: SupplierFilterOption[];
  /** Active ?supplier= id, or undefined for "All". */
  current?: string;
};

export default function SupplierFilter({ options, current }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
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

  function applyFilter(next: string | undefined) {
    setOpen(false);
    const params = new URLSearchParams(sp.toString());
    if (next == null) params.delete("supplier");
    else params.set("supplier", next);
    const qs = params.toString();
    router.push(qs ? `/admin?${qs}` : "/admin");
  }

  const currentName = current
    ? options.find((o) => o.id === current)?.name ?? current
    : null;
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
        <span>
          Retailer:{" "}
          <span className="font-medium">{currentName ?? "All"}</span>
        </span>
        <span aria-hidden className="ml-1 text-[10px]">
          ▾
        </span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-md border border-neutral-200 bg-white shadow-lg">
          <div className="max-h-[24rem] overflow-auto p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
              Filter by retailer · single select
            </div>
            <div className="flex flex-wrap gap-1.5">
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
              {options.map((o) => {
                const active = o.id === current;
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => applyFilter(o.id)}
                    className={`rounded-md border px-3 py-1.5 text-xs transition ${
                      active
                        ? "border-black bg-black text-white"
                        : "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-500"
                    }`}
                  >
                    {o.name}
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
