"use client";

/**
 * Inline table-cell editors for the admin product list.
 *
 * Interaction (fixed spec): click the cell → it becomes a control → blur or
 * Enter saves, Esc cancels. Per-cell saves, no row edit mode, no Save button.
 * Success flashes the cell green; failure shows a red message under the cell
 * and rolls the displayed value back to what the DB still holds.
 *
 * All three controls share `useInlineSave` so the save / flash / rollback /
 * error behavior exists once. Every save goes through saveInlineFieldAction,
 * which re-runs the /edit workbench's own validation server-side — the client
 * never decides whether a value is legal.
 *
 * Note these live INSIDE <form id="bulk-form"> (the bulk-select form), so
 * Enter must be preventDefault()-ed or the browser would submit that form.
 * The inputs are deliberately unnamed so they never ride along in a bulk post.
 */

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  saveInlineFieldAction,
  type InlineField,
} from "@/app/admin/(dashboard)/products/inline-edit-actions";

export type Option = { slug: string; label: string };

function useInlineSave(productId: string, field: InlineField) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);

  function save(value: string | string[], rollback: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await saveInlineFieldAction(productId, field, value);
      if (res.ok) {
        setFlash(true);
        setTimeout(() => setFlash(false), 900);
        router.refresh();
      } else {
        setError(res.error);
        rollback();
      }
    });
  }
  return { save, pending, error, flash, setError };
}

/** Green flash on success, dimmed while the action is in flight. */
function cellTone(flash: boolean, pending: boolean): string {
  return `${flash ? "bg-emerald-100 ring-1 ring-emerald-400" : ""} ${pending ? "opacity-60" : ""}`;
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="mt-0.5 text-[10px] leading-tight text-rose-700">{error}</div>
  );
}

// ─────────────────────────────────────────────────────────────
// Text — name / SKU / brand
// ─────────────────────────────────────────────────────────────
export function InlineTextCell({
  productId,
  field,
  value,
  empty,
  mono,
  inputClass,
}: {
  productId: string;
  field: Extract<InlineField, "name" | "sku_id" | "brand">;
  value: string | null;
  /** What to render when the stored value is empty (e.g. the 缺 SKU chip). */
  empty?: ReactNode;
  mono?: boolean;
  inputClass?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [shown, setShown] = useState(value ?? "");
  const [draft, setDraft] = useState(value ?? "");
  const committed = useRef(false);
  const { save, pending, error, flash, setError } = useInlineSave(productId, field);

  // Re-sync when the server component re-renders with fresh data.
  useEffect(() => setShown(value ?? ""), [value]);

  function begin() {
    setError(null);
    setDraft(shown);
    committed.current = false;
    setEditing(true);
  }
  function commit() {
    if (committed.current) return; // Enter already committed; ignore the blur
    committed.current = true;
    setEditing(false);
    const next = draft.trim();
    if (next === shown.trim()) return; // no-op edit, don't hit the server
    const prev = shown;
    setShown(next); // optimistic
    save(next, () => setShown(prev));
  }
  function cancel() {
    committed.current = true;
    setEditing(false);
    setDraft(shown);
    setError(null);
  }

  if (editing) {
    return (
      <div>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault(); // never submit the surrounding bulk-form
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          className={`w-full rounded border border-sky-400 px-1.5 py-0.5 text-xs outline-none ring-1 ring-sky-200 ${mono ? "font-mono" : ""} ${inputClass ?? ""}`}
        />
        <ErrorLine error={error} />
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={begin}
        title="Click to edit"
        className={`w-full rounded px-1 py-0.5 text-left transition hover:bg-neutral-100 ${cellTone(flash, pending)}`}
      >
        {shown ? (
          <span className={mono ? "font-mono text-neutral-700" : undefined}>
            {shown}
          </span>
        ) : (
          (empty ?? <span className="text-neutral-400">—</span>)
        )}
      </button>
      <ErrorLine error={error} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Single select — subtype (options follow the row's item type)
// ─────────────────────────────────────────────────────────────
export function InlineSelectCell({
  productId,
  field,
  value,
  options,
  disabledHint,
}: {
  productId: string;
  field: Extract<InlineField, "subtype_slug">;
  value: string | null;
  options: Option[];
  /** Shown instead of the control when there's nothing to pick (no item
   *  type on the row, or that type has no subtypes). */
  disabledHint?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [shown, setShown] = useState(value);
  const { save, pending, error, flash, setError } = useInlineSave(productId, field);

  useEffect(() => setShown(value), [value]);

  const label = shown
    ? (options.find((o) => o.slug === shown)?.label ?? shown)
    : null;

  if (options.length === 0) {
    return (
      <span className="text-[11px] text-neutral-400" title={disabledHint}>
        {label ? `↳ ${label}` : "—"}
      </span>
    );
  }

  function commit(next: string) {
    setEditing(false);
    if (next === (shown ?? "")) return;
    const prev = shown;
    setShown(next === "" ? null : next);
    save(next, () => setShown(prev));
  }

  if (editing) {
    return (
      <div>
        <select
          autoFocus
          defaultValue={shown ?? ""}
          onChange={(e) => commit(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
              setError(null);
            }
          }}
          className="w-full rounded border border-sky-400 px-1 py-0.5 text-[11px] outline-none ring-1 ring-sky-200"
        >
          <option value="">—</option>
          {options.map((o) => (
            <option key={o.slug} value={o.slug}>
              {o.label}
            </option>
          ))}
        </select>
        <ErrorLine error={error} />
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setEditing(true);
        }}
        title="Click to edit subtype"
        className={`rounded px-1 text-[11px] text-neutral-500 transition hover:bg-neutral-100 ${cellTone(flash, pending)}`}
      >
        {label ? `↳ ${label}` : "↳ —"}
      </button>
      <ErrorLine error={error} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Multi pills — rooms / styles
// ─────────────────────────────────────────────────────────────
export function InlineMultiCell({
  productId,
  field,
  value,
  options,
}: {
  productId: string;
  field: Extract<InlineField, "room_slugs" | "styles">;
  value: string[];
  options: Option[];
}) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<string[]>(value ?? []);
  const [draft, setDraft] = useState<string[]>(value ?? []);
  const ref = useRef<HTMLDivElement>(null);
  const committed = useRef(false);
  const { save, pending, error, flash, setError } = useInlineSave(productId, field);

  useEffect(() => setShown(value ?? []), [value]);

  const same = (a: string[], b: string[]) =>
    a.length === b.length && a.every((x) => b.includes(x));

  // Click-outside = blur = save (matches the text cells' blur-to-save rule).
  useEffect(() => {
    if (!open) return;
    function commitOutside(e: MouseEvent) {
      if (ref.current?.contains(e.target as Node)) return;
      if (committed.current) return;
      committed.current = true;
      setOpen(false);
      setDraft((d) => {
        if (!same(d, shown)) {
          const prev = shown;
          setShown(d);
          save(d, () => setShown(prev));
        }
        return d;
      });
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        committed.current = true;
        setOpen(false);
        setDraft(shown);
        setError(null);
      }
    }
    document.addEventListener("mousedown", commitOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", commitOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, shown, save, setError]);

  const labelOf = (s: string) =>
    options.find((o) => o.slug === s)?.label ?? s;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          setError(null);
          setDraft(shown);
          committed.current = false;
          setOpen((o) => !o);
        }}
        title="Click to edit"
        className={`flex w-full flex-wrap items-center gap-1 rounded px-1 py-0.5 text-left transition hover:bg-neutral-100 ${cellTone(flash, pending)}`}
      >
        {shown.length === 0 ? (
          <span className="text-xs text-neutral-400">—</span>
        ) : (
          <>
            {shown.slice(0, 2).map((s) => (
              <span
                key={s}
                className="inline-block rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-700"
              >
                {labelOf(s)}
              </span>
            ))}
            {shown.length > 2 && (
              <span className="text-[11px] text-neutral-500">
                +{shown.length - 2} more
              </span>
            )}
          </>
        )}
      </button>
      <ErrorLine error={error} />

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 max-h-64 w-64 overflow-auto rounded-md border border-neutral-200 bg-white p-2 shadow-lg">
          <div className="mb-1 text-[10px] text-neutral-400">
            Click outside to save · Esc to cancel
          </div>
          <div className="flex flex-wrap gap-1">
            {options.map((o) => {
              const on = draft.includes(o.slug);
              return (
                <button
                  key={o.slug}
                  type="button"
                  onClick={() =>
                    setDraft((d) =>
                      d.includes(o.slug)
                        ? d.filter((x) => x !== o.slug)
                        : [...d, o.slug],
                    )
                  }
                  className={`rounded-full px-2 py-0.5 text-[11px] transition ${
                    on
                      ? "bg-black text-white"
                      : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
                  }`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
