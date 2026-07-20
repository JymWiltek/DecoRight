"use client";

/**
 * Brand picker — type-to-filter list of the brands the catalog already
 * carries, plus an explicit Add row for a genuinely new one.
 *
 * Why a picker at all: brand was free text, so the same company kept arriving
 * under different spellings (SANIWARE / Saniware, WILTEK / Wiltek / WTK). The
 * casing gate (lib/admin/brand-normalize) fixes that on write, but it's a
 * safety net — picking from the real list stops the mistake being made.
 * Adding is still allowed: a new supplier must be able to get in without a
 * code change, and whatever is typed still goes through the gate server-side.
 *
 * Used in two places with the same options, so what the list offers can't
 * drift from what /edit offers:
 *   • the product list's inline brand cell (InlineBrandCell)
 *   • the /edit workbench's Brand field (ProductForm)
 *
 * Empty is a legal value — it means "not filled", not an error.
 */

import { useEffect, useMemo, useRef, useState } from "react";

type Props = {
  /** Current brand ("" = not set). */
  value: string;
  /** Distinct brands already in the catalog, alphabetical. */
  options: string[];
  /** Fires on every keystroke AND on pick, so a parent form's hidden input
   *  stays in sync even when the operator types a brand-new name. */
  onChange: (v: string) => void;
  /** Fires when the operator settles on a value (pick / Add / Enter / blur).
   *  The inline cell uses this to save; the /edit form leaves it undefined
   *  because its Save button owns committing. */
  onCommit?: (v: string) => void;
  /** Esc. */
  onCancel?: () => void;
  autoFocus?: boolean;
  inputClassName?: string;
  placeholder?: string;
};

export default function BrandCombobox({
  value,
  options,
  onChange,
  onCommit,
  onCancel,
  autoFocus,
  inputClassName,
  placeholder,
}: Props) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(!!autoFocus);
  // The input is pre-filled with the current brand, so treating it as a filter
  // straight away would open the list showing only that one brand. Nothing is
  // filtered until the operator actually types — opening shows the full list,
  // which is the point of having a picker.
  const [typed, setTyped] = useState(false);
  const [hi, setHi] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const settled = useRef(false);

  useEffect(() => setQuery(value), [value]);
  // Reset the filter when the list OPENS, not when the value changes — the
  // value round-trips through the parent on every keystroke (controlled), so
  // keying this on `value` would clear `typed` after each character and the
  // list would never filter.
  useEffect(() => {
    if (open) setTyped(false);
  }, [open]);

  const q = query.trim();
  const filtered = useMemo(() => {
    if (!typed || q === "") return options;
    const needle = q.toLowerCase();
    return options.filter((o) => o.toLowerCase().includes(needle));
  }, [typed, q, options]);
  // Case-insensitive, because "saniware" must NOT offer to add a second
  // SANIWARE — it should match the existing one.
  const exactHit = options.some((o) => o.trim().toLowerCase() === q.toLowerCase());
  const canAdd = typed && q !== "" && !exactHit;
  const rows: { label: string; value: string; add?: boolean }[] = [
    ...filtered.map((o) => ({ label: o, value: o })),
    ...(canAdd ? [{ label: `Add "${q}"`, value: q, add: true }] : []),
  ];

  useEffect(() => setHi(0), [q]);

  function settle(v: string) {
    settled.current = true;
    setQuery(v);
    setOpen(false);
    onChange(v);
    onCommit?.(v);
  }

  // Click outside = settle on whatever is typed (blur-to-save, same rule as
  // the other inline cells).
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (boxRef.current?.contains(e.target as Node)) return;
      if (settled.current) return;
      settle(q);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  });

  return (
    <div ref={boxRef} className="relative">
      <input
        autoFocus={autoFocus}
        value={query}
        placeholder={placeholder ?? "Pick or type a brand"}
        onChange={(e) => {
          settled.current = false;
          setTyped(true);
          setQuery(e.target.value);
          setOpen(true);
          onChange(e.target.value);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setHi((i) => Math.min(i + 1, Math.max(rows.length - 1, 0)));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            // Never submit the surrounding form from here.
            e.preventDefault();
            settle(open && rows[hi] ? rows[hi].value : q);
          } else if (e.key === "Escape") {
            e.preventDefault();
            settled.current = true;
            setOpen(false);
            setQuery(value);
            onChange(value);
            onCancel?.();
          }
        }}
        className={
          inputClassName ??
          "w-full rounded border border-sky-400 px-1.5 py-0.5 text-xs outline-none ring-1 ring-sky-200"
        }
      />

      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 max-h-56 w-56 overflow-auto rounded-md border border-neutral-200 bg-white py-1 shadow-lg">
          {rows.length === 0 && (
            <div className="px-2 py-1.5 text-[11px] text-neutral-400">
              No brands yet — type one to add it.
            </div>
          )}
          {rows.map((r, i) => (
            <button
              key={`${r.value}-${r.add ? "add" : "opt"}`}
              type="button"
              // mousedown, not click: the outside-click handler fires on
              // mousedown and would close the list before a click landed.
              onMouseDown={(e) => {
                e.preventDefault();
                settle(r.value);
              }}
              onMouseEnter={() => setHi(i)}
              className={`block w-full px-2 py-1.5 text-left text-xs ${
                i === hi ? "bg-neutral-100" : ""
              } ${r.add ? "text-sky-700" : "text-neutral-800"}`}
            >
              {r.add ? (
                <>
                  <span className="font-medium">Add</span>{" "}
                  <span className="font-mono">&ldquo;{q}&rdquo;</span>
                </>
              ) : (
                r.label
              )}
            </button>
          ))}
          {value !== "" && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                settle("");
              }}
              className="mt-1 block w-full border-t border-neutral-100 px-2 py-1.5 text-left text-[11px] text-neutral-500 hover:bg-neutral-50"
            >
              Clear brand
            </button>
          )}
        </div>
      )}
    </div>
  );
}
