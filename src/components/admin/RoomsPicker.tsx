"use client";

/**
 * Multi-select rooms for a product. Submits as repeated hidden
 * `room_slugs` inputs — exactly what parsePayload's
 * pickManyFromSet("room_slugs", …) expects.
 *
 * The list orders rooms by "recommended for this item type first"
 * (via the item_type_rooms M2M), so the admin's common case
 * (faucet → kitchen/bathroom/balcony) is one tap away. They can
 * still pick any room — room and item_type are independent per
 * Migration 0013, the M2M is a hint not a constraint.
 *
 * Watches the sibling `item_type` input the same way SubtypePicker
 * does (formEl.elements poll, not DOM descendants) so the
 * recommended-first ordering updates live when the operator
 * changes item type.
 */

import { useEffect, useMemo, useState } from "react";
import type { ItemTypeRoomRow, TaxonomyRow } from "@/lib/supabase/types";

type Props = {
  form: string;
  rooms: TaxonomyRow[];
  itemTypeRooms: ItemTypeRoomRow[];
  initial: string[];
  initialItemType: string | null;
};

export default function RoomsPicker({
  form,
  rooms,
  itemTypeRooms,
  initial,
  initialItemType,
}: Props) {
  const [itemType, setItemType] = useState<string | null>(initialItemType);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initial),
  );

  // Poll sibling item_type hidden input (PillGrid pattern). See
  // SubtypePicker for the full rationale; short version: hidden
  // inputs live outside <form> via `form=`, so formEl.elements is
  // the only reliable enumeration.
  useEffect(() => {
    const formEl = document.getElementById(form) as HTMLFormElement | null;
    if (!formEl) return;
    const tick = () => {
      const matches = [...formEl.elements].filter(
        (el): el is HTMLInputElement =>
          el instanceof HTMLInputElement && el.name === "item_type",
      );
      const next = matches.length > 0 ? matches[0].value : null;
      setItemType((prev) => (prev === next ? prev : next));
    };
    tick();
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [form]);

  const recommended = useMemo(() => {
    if (!itemType) return new Set<string>();
    return new Set(
      itemTypeRooms
        .filter((r) => r.item_type_slug === itemType)
        .map((r) => r.room_slug),
    );
  }, [itemType, itemTypeRooms]);

  // Order: recommended first (in the admin's existing sort_order),
  // then the rest. Stable so the picker doesn't reshuffle on every
  // click.
  const ordered = useMemo(() => {
    const rec: TaxonomyRow[] = [];
    const rest: TaxonomyRow[] = [];
    for (const r of rooms) {
      if (recommended.has(r.slug)) rec.push(r);
      else rest.push(r);
    }
    return [...rec, ...rest];
  }, [rooms, recommended]);

  function toggle(slug: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {[...selected].map((slug) => (
        <input
          key={slug}
          form={form}
          type="hidden"
          name="room_slugs"
          value={slug}
        />
      ))}
      <div className="flex flex-wrap gap-2">
        {ordered.map((r) => {
          const active = selected.has(r.slug);
          const isRecommended = recommended.has(r.slug);
          return (
            <button
              key={r.slug}
              type="button"
              onClick={() => toggle(r.slug)}
              aria-pressed={active}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                active
                  ? "border-black bg-black text-white"
                  : isRecommended
                    ? "border-sky-300 bg-sky-50 text-sky-800 hover:border-sky-500"
                    : "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-500"
              }`}
              title={
                isRecommended
                  ? "Recommended for this item type"
                  : "Not typically paired with this item type — still allowed"
              }
            >
              {r.label_en}
              {isRecommended && !active && (
                <span className="ml-1 text-[10px] opacity-60">★</span>
              )}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-neutral-500">
        Published products must have at least one room.
        {itemType && recommended.size > 0 && (
          <> Rooms marked ★ are typical for this item type.</>
        )}
      </p>
    </div>
  );
}
