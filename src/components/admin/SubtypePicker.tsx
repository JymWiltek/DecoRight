"use client";

/**
 * Cascading subtype picker for ProductForm.
 *
 * Watches the sibling `item_type` field (a PillGrid that submits
 * hidden <input name="item_type">) by polling the form's elements
 * each render — the lightest cross-component channel that doesn't
 * require lifting state into ProductForm or using context. Only
 * shows itself when the picked item_type actually has subtypes;
 * otherwise renders a "no subtypes for this item type" hint so the
 * operator isn't confused by silence.
 *
 * Submits as a single hidden `subtype_slug` input. Validation that
 * (item_type, subtype_slug) belong together is enforced server-side
 * (parsePayload + DB trigger products_subtype_consistent), so the UI
 * only needs to make the right choice easy — not bulletproof.
 */

import { useEffect, useState } from "react";
import type { ItemSubtypeRow } from "@/lib/supabase/types";

type Props = {
  /** All subtypes from taxonomy. We filter client-side because the
   *  list is small (<100 rows total) and avoids a round-trip on
   *  every item_type change. */
  subtypes: ItemSubtypeRow[];
  /** form="..." so the hidden input submits with ProductForm's main form. */
  form: string;
  /** Initial selection — the row's current subtype_slug (or null). */
  initial: string | null;
  /** Initial item_type so the first render picks the right options
   *  even before the user touches anything. */
  initialItemType: string | null;
};

export default function SubtypePicker({
  subtypes,
  form,
  initial,
  initialItemType,
}: Props) {
  const [itemType, setItemType] = useState<string | null>(initialItemType);
  const [selected, setSelected] = useState<string | null>(initial);

  // Watch the sibling item_type input. We poll because PillGrid is a
  // separate component that renders <input type="hidden" name="item_type">
  // inside the same logical form — and there's no DOM event when the
  // user clicks a pill (PillGrid doesn't emit a custom event). 100ms
  // is imperceptible to humans and still cheap.
  useEffect(() => {
    const formEl = document.getElementById(form) as HTMLFormElement | null;
    if (!formEl) return;
    const tick = () => {
      const inputs = formEl.querySelectorAll<HTMLInputElement>(
        'input[name="item_type"]',
      );
      // PillGrid emits 0 or 1 hidden input (single-select). Read its
      // value — null when nothing picked.
      const next = inputs.length > 0 ? inputs[0].value : null;
      setItemType((prev) => (prev === next ? prev : next));
    };
    tick();
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [form]);

  // When item_type changes away from the one our `selected` belongs
  // to, clear `selected` so we don't submit a stale (item_type,
  // subtype) pair that the trigger would reject.
  useEffect(() => {
    if (!selected) return;
    const stillBelongs = subtypes.some(
      (s) => s.slug === selected && s.item_type_slug === itemType,
    );
    if (!stillBelongs) setSelected(null);
  }, [itemType, selected, subtypes]);

  const options = itemType
    ? subtypes.filter((s) => s.item_type_slug === itemType)
    : [];

  function toggle(slug: string) {
    setSelected((prev) => (prev === slug ? null : slug));
  }

  if (!itemType) {
    return (
      <div className="rounded-md border border-dashed border-neutral-300 px-3 py-3 text-xs text-neutral-500">
        Pick an item type above first — subtypes are scoped to it.
      </div>
    );
  }

  if (options.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-neutral-300 px-3 py-3 text-xs text-neutral-500">
        No subtypes for this item type. The room comes from the item
        type itself. Add subtypes on the{" "}
        <a href="/admin/taxonomy" className="text-sky-600 hover:underline">
          Taxonomy
        </a>{" "}
        page if needed.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {selected && (
        <input form={form} type="hidden" name="subtype_slug" value={selected} />
      )}
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const active = selected === opt.slug;
          return (
            <button
              key={opt.slug}
              type="button"
              onClick={() => toggle(opt.slug)}
              aria-pressed={active}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                active
                  ? "border-black bg-black text-white"
                  : "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-500"
              }`}
              title={`Room: ${opt.room_slug}`}
            >
              {opt.label_en}
              <span className="ml-1.5 text-[10px] opacity-60">
                → {opt.room_slug}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-neutral-500">
        Room is derived from the picked subtype. Click again to clear.
      </p>
    </div>
  );
}
