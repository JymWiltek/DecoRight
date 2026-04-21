"use client";

import { useState } from "react";

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
  const { name, options, variant = "pill", emptyLabel } = props;
  const isMulti = props.multi === true;

  const initialState: string[] = isMulti
    ? [...props.initial]
    : props.initial != null
      ? [props.initial]
      : [];

  const [selected, setSelected] = useState<string[]>(initialState);

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
        {emptyLabel ?? "没有选项。前往"}
        <a href="/admin/taxonomy" className="mx-1 text-sky-600 hover:underline">
          分类管理
        </a>
        添加。
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* hidden inputs that actually submit */}
      {selected.map((s) => (
        <input key={s} type="hidden" name={name} value={s} />
      ))}

      <div className={variant === "color" ? "flex flex-wrap gap-2" : "flex flex-wrap gap-2"}>
        {options.map((opt) => {
          const active = selected.includes(opt.slug);
          if (variant === "color") {
            return (
              <button
                key={opt.slug}
                type="button"
                onClick={() => toggle(opt.slug)}
                aria-pressed={active}
                title={opt.label}
                className={`relative h-9 w-9 rounded-full border transition ${
                  active
                    ? "border-black ring-2 ring-black ring-offset-1"
                    : "border-neutral-300 hover:border-neutral-500"
                }`}
                style={{ backgroundColor: opt.hex ?? "#ccc" }}
              >
                <span className="sr-only">{opt.label}</span>
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
