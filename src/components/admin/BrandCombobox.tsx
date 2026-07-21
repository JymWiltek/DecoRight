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
  /** Called when the operator picks the "Add …" row for a brand not in the
   *  list. If provided, a confirm dialog appears first and the brand is only
   *  written (and the cell filled) on confirm — the combobox stays generic and
   *  the write itself lives in the caller's action. If omitted, "Add" settles
   *  the typed value directly (legacy behaviour). */
  onAddNew?: (name: string) => Promise<{ ok: boolean; error?: string }>;
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
  onAddNew,
  autoFocus,
  inputClassName,
  placeholder,
}: Props) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(!!autoFocus);
  // The brand-name pending confirmation in the "add to brand table?" dialog,
  // or null when no dialog is open.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
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

  /** Picking a row. A brand-new name (add=true) with an onAddNew handler opens
   *  the confirm dialog instead of settling directly; everything else settles. */
  function pick(v: string, add?: boolean) {
    if (add && onAddNew) {
      settled.current = true; // stop the outside-click handler settling the raw text
      setAddError(null);
      setConfirming(v);
      return;
    }
    settle(v);
  }

  async function confirmAdd() {
    if (confirming == null) return;
    setAdding(true);
    setAddError(null);
    const res = await onAddNew!(confirming);
    setAdding(false);
    if (res.ok) {
      const name = confirming;
      setConfirming(null);
      settle(name);
    } else {
      setAddError(res.error ?? "Could not add brand.");
    }
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
            if (open && rows[hi]) pick(rows[hi].value, rows[hi].add);
            else settle(q);
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
                pick(r.value, r.add);
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

      {/* Confirm dialog for adding a brand not yet in the brand table. Nothing
          is written until the operator confirms — Cancel leaves the table
          untouched and the cell unchanged. */}
      {confirming != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
            <div className="mb-2 text-sm text-neutral-800">
              <span className="font-mono font-medium">
                &ldquo;{confirming}&rdquo;
              </span>{" "}
              不在品牌库,确认新增为品牌?
            </div>
            <p className="mb-4 text-xs text-neutral-500">
              It will be added to the brand list (through the casing gate) and
              set on this product.
            </p>
            {addError && (
              <div className="mb-3 text-xs text-rose-700">{addError}</div>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={adding}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setConfirming(null);
                  setAddError(null);
                }}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:border-neutral-500 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={adding}
                onMouseDown={(e) => e.preventDefault()}
                onClick={confirmAdd}
                className="rounded-md bg-black px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
              >
                {adding ? "Adding…" : "确认新增"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
