"use client";

/**
 * Regions multi-select grouped into the 5 conventional Malaysian
 * retail buckets (north / central / south / east / sabah_sarawak).
 *
 * Submits one hidden <input name="store_locations" value={slug}> per
 * picked region — server reads via fd.getAll("store_locations").
 * Same hidden-input-per-value pattern as PillGrid.
 *
 * Why a dedicated component instead of reusing PillGrid: regions
 * benefit from being grouped by region bucket so the operator can
 * eyeball "all of central" at once, and we want a "select all in
 * group" toggle. PillGrid is for flat single-/multi-select; adding
 * grouping there would muddy its API.
 */

import { useState } from "react";
import type { RegionRow } from "@/lib/supabase/types";

type Props = {
  regions: RegionRow[];
  form: string;
  initial: string[];
};

const GROUP_LABELS: Record<RegionRow["region"], string> = {
  north: "Northern",
  central: "Central",
  south: "Southern",
  east: "East Coast",
  sabah_sarawak: "East Malaysia",
};

const GROUP_ORDER: RegionRow["region"][] = [
  "north",
  "central",
  "south",
  "east",
  "sabah_sarawak",
];

export default function RegionsPicker({ regions, form, initial }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initial));

  function toggle(slug: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  function toggleGroup(group: RegionRow["region"]) {
    const inGroup = regions.filter((r) => r.region === group);
    setSelected((prev) => {
      const next = new Set(prev);
      const allOn = inGroup.every((r) => next.has(r.slug));
      if (allOn) {
        for (const r of inGroup) next.delete(r.slug);
      } else {
        for (const r of inGroup) next.add(r.slug);
      }
      return next;
    });
  }

  function clearAll() {
    setSelected(new Set());
  }

  if (regions.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-neutral-300 px-3 py-4 text-xs text-neutral-500">
        No regions seeded yet. Run migration 0011.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {[...selected].map((slug) => (
        <input
          key={slug}
          form={form}
          type="hidden"
          name="store_locations"
          value={slug}
        />
      ))}

      <div className="flex items-center justify-between text-xs text-neutral-500">
        <span>{selected.size} region(s) selected</span>
        {selected.size > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="text-neutral-500 underline hover:text-rose-600"
          >
            Clear all
          </button>
        )}
      </div>

      {GROUP_ORDER.map((group) => {
        const inGroup = regions
          .filter((r) => r.region === group)
          .sort((a, b) => a.sort_order - b.sort_order);
        if (inGroup.length === 0) return null;
        const allOn = inGroup.every((r) => selected.has(r.slug));
        return (
          <div key={group} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                {GROUP_LABELS[group]}
              </span>
              <button
                type="button"
                onClick={() => toggleGroup(group)}
                className="text-[11px] text-sky-600 hover:underline"
              >
                {allOn ? "Unselect group" : "Select group"}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {inGroup.map((r) => {
                const active = selected.has(r.slug);
                return (
                  <button
                    key={r.slug}
                    type="button"
                    onClick={() => toggle(r.slug)}
                    aria-pressed={active}
                    className={`rounded-full border px-3 py-1 text-xs transition ${
                      active
                        ? "border-black bg-black text-white"
                        : "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-500"
                    }`}
                  >
                    {r.label_en}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      <p className="text-[11px] text-neutral-500">
        Empty selection = nationally available / unspecified. Pick the
        states where Wiltek physically stocks this product.
      </p>
    </div>
  );
}
