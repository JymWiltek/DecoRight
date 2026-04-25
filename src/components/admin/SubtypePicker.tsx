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
 *
 * Migration 0013: subtype describes shape/style only (pull-out,
 * sensor, L-shape). Room is orthogonal now — see RoomsPicker.
 */

import { useEffect, useState } from "react";
import type { ItemSubtypeRow } from "@/lib/supabase/types";
import { subscribeAutofillApply } from "@/lib/ai/autofill-bus";
import TriLingualLabel from "./TriLingualLabel";

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
  // associated with the same logical form — and there's no DOM event
  // when the user clicks a pill (PillGrid doesn't emit a custom event).
  // 100ms is imperceptible to humans and still cheap.
  //
  // IMPORTANT: the hidden inputs live OUTSIDE the <form> tag and
  // associate via the HTML5 `form="..."` attribute, so a descendant
  // query (`formEl.querySelectorAll(...)`) returns nothing. Use
  // `formEl.elements`, which is the form's controls collection and
  // DOES include form-associated external inputs. Learned the hard
  // way when switching ProductForm to the "empty <form> + external
  // inputs" layout so the image section could live between Basics and
  // Item type.
  useEffect(() => {
    const formEl = document.getElementById(form) as HTMLFormElement | null;
    if (!formEl) return;
    const tick = () => {
      const matches = [...formEl.elements].filter(
        (el): el is HTMLInputElement =>
          el instanceof HTMLInputElement && el.name === "item_type",
      );
      // PillGrid emits 0 or 1 hidden input (single-select). Read its
      // value — null when nothing picked.
      const next = matches.length > 0 ? matches[0].value : null;
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

  // Vision-autofill listener. The AI payload only makes sense if
  // the picked subtype actually belongs to the item_type that's
  // currently selected — we enforce that here as a second line of
  // defense on top of the server-side taxonomy guard in infer.ts.
  useEffect(() => {
    return subscribeAutofillApply((detail) => {
      if (detail.subtype_slug === undefined) return;
      if (!detail.subtype_slug) {
        setSelected(null);
        return;
      }
      const sub = subtypes.find((s) => s.slug === detail.subtype_slug);
      const pickedItemType = detail.item_type ?? itemType;
      if (sub && sub.item_type_slug === pickedItemType) {
        setSelected(sub.slug);
      } else {
        setSelected(null);
      }
    });
  }, [subtypes, itemType]);

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
        No subtypes defined for this item type — leave empty and move on.
        Add subtypes on the{" "}
        <a href="/admin/taxonomy" className="text-sky-600 hover:underline">
          Taxonomy
        </a>{" "}
        page if you need shape/style variants (e.g. Faucet →
        Pull-out / Sensor / Traditional).
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
              className={`rounded-md border px-3 py-2 transition ${
                active
                  ? "border-black bg-black text-white"
                  : "border-neutral-300 bg-white text-neutral-800 hover:border-neutral-500"
              }`}
            >
              <TriLingualLabel
                en={opt.label_en}
                zh={opt.label_zh}
                ms={opt.label_ms}
              />
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-neutral-500">
        Optional. Describes shape/style only — click again to clear.
      </p>
    </div>
  );
}
