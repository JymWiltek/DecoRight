"use client";

import { useEffect, useState } from "react";
import {
  subscribeAutofillApply,
  type AutofillApplyDetail,
  type AutofillFieldName,
} from "@/lib/ai/autofill-bus";

export type PillOption = {
  slug: string;
  label: string;
  hex?: string; // colors only
};

type BaseProps = {
  name: string;
  options: PillOption[];
  variant?: "pill" | "color";
  emptyLabel?: string; // shown when no options seeded yet
  /**
   * Optional id of the <form> the hidden inputs should submit with.
   * Used by ProductForm — the main <form> is empty and every field
   * (including these) links to it via `form={FORM_ID}` so the whole
   * workbench can render as siblings (with the image section between
   * Basics and Taxonomy). Omit on standalone pages.
   */
  form?: string;
};

type SingleProps = BaseProps & {
  multi?: false;
  initial: string | null;
};

type MultiProps = BaseProps & {
  multi: true;
  initial: string[];
};

type Props = SingleProps | MultiProps;

/**
 * Visible-at-a-glance selector. Click a pill (or color dot) to toggle.
 *
 * Submits as one or more hidden <input name={name}> values so the server
 * action reads via fd.getAll(name) (multi) or fd.get(name) (single).
 *
 * Design principle: NEVER hide options inside a <select>. The user sees
 * everything available and clicks once. That's the whole point.
 */
export default function PillGrid(props: Props) {
  const { name, options, variant = "pill", emptyLabel, form } = props;
  const isMulti = props.multi === true;

  const initialState: string[] = isMulti
    ? [...props.initial]
    : props.initial != null
      ? [props.initial]
      : [];

  const [selected, setSelected] = useState<string[]>(initialState);

  // Listen for Vision-autofill events. The AIInferButton broadcasts
  // once per run; each picker grabs its own slice by matching `name`.
  // We ignore the event if its payload for this field is undefined
  // (the AI didn't try) so clicking "Re-run AI" doesn't clobber
  // pickers the model has no opinion about.
  useEffect(() => {
    return subscribeAutofillApply((detail: AutofillApplyDetail) => {
      const key = name as AutofillFieldName;
      const valid = new Set(options.map((o) => o.slug));
      if (isMulti) {
        const picks = detail[key as "room_slugs" | "styles" | "colors" | "materials"];
        if (!Array.isArray(picks)) return;
        setSelected(picks.filter((s): s is string => typeof s === "string" && valid.has(s)));
      } else {
        const pick = detail[key as "item_type" | "subtype_slug"];
        if (pick === undefined) return;
        setSelected(pick && valid.has(pick) ? [pick] : []);
      }
    });
  }, [name, options, isMulti]);

  function toggle(slug: string) {
    setSelected((prev) => {
      if (isMulti) {
        return prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug];
      }
      // single-select: replace or clear if same
      return prev[0] === slug ? [] : [slug];
    });
  }

  if (options.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-neutral-300 px-3 py-4 text-xs text-neutral-500">
        {emptyLabel ?? "No options yet — add some under "}
        <a href="/admin/taxonomy" className="mx-1 text-sky-600 hover:underline">
          Taxonomy
        </a>
        .
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* hidden inputs that actually submit */}
      {selected.map((s) => (
        <input key={s} form={form} type="hidden" name={name} value={s} />
      ))}

      <div className={variant === "color" ? "flex flex-wrap gap-x-3 gap-y-3" : "flex flex-wrap gap-2"}>
        {options.map((opt) => {
          const active = selected.includes(opt.slug);
          if (variant === "color") {
            return (
              <button
                key={opt.slug}
                type="button"
                onClick={() => toggle(opt.slug)}
                aria-pressed={active}
                className="flex w-14 flex-col items-center gap-1 text-center"
              >
                <span
                  aria-hidden
                  className={`h-9 w-9 rounded-full border transition ${
                    active
                      ? "border-black ring-2 ring-black ring-offset-1"
                      : "border-neutral-300 group-hover:border-neutral-500"
                  }`}
                  style={{ backgroundColor: opt.hex ?? "#ccc" }}
                />
                <span
                  className={`text-[11px] leading-tight ${
                    active ? "font-semibold text-neutral-900" : "text-neutral-600"
                  }`}
                >
                  {opt.label}
                </span>
              </button>
            );
          }
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
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
