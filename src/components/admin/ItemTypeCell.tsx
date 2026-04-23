"use client";

/**
 * Click the item-type label → opens a popover with the full pill
 * grid of item types. Picking a pill is a *pending* choice — it
 * only commits on Save. Cancel discards. Changing item_type also
 * clears subtype_slug server-side (the old subtype almost
 * certainly doesn't belong to the new item_type, and the DB
 * trigger would reject it).
 *
 * Why explicit Save/Cancel: the previous auto-save-on-pill-click
 * behavior was too easy to trigger by accident. Every inline
 * edit on /admin now requires a deliberate Save.
 *
 * Why no nested <form>: /admin's table is wrapped in
 * <form id="bulk-form"> for bulk ops; nesting forms is invalid
 * HTML. We call the server action directly — React 19 server
 * actions are plain async functions.
 *
 * "—" (no item type) is a valid choice, rendered as a dashed pill.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { setProductItemTypeAction } from "@/app/admin/(dashboard)/products/actions";

type Option = { slug: string; label: string };

type Props = {
  productId: string;
  current: string | null;
  options: Option[];
};

export default function ItemTypeCell({ productId, current, options }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  // `null` = "—" (clear); a string = that item_type slug.
  // Starts at `current` whenever the popover opens so Cancel
  // returns to the row's actual DB state.
  const [draft, setDraft] = useState<string | null>(current);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(current);
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
  }, [open, current]);

  const currentLabel = current
    ? (options.find((o) => o.slug === current)?.label ?? current)
    : "—";

  const dirty = draft !== current;

  function save() {
    if (!dirty) {
      setOpen(false);
      return;
    }
    setOpen(false);
    const fd = new FormData();
    fd.set("id", productId);
    fd.set("item_type", draft ?? "");
    startTransition(async () => {
      await setProductItemTypeAction(fd);
    });
  }

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={pending}
        className={`rounded border border-transparent px-1 py-0.5 text-left text-neutral-700 hover:border-neutral-300 hover:bg-neutral-50 ${
          pending ? "opacity-50" : ""
        }`}
        title="Click to change item type"
      >
        {currentLabel}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded-md border border-neutral-200 bg-white shadow-lg">
          <div className="max-h-80 overflow-auto p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
              Pick item type · Save will also clear the subtype
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setDraft(null)}
                className={`rounded-full border border-dashed px-2.5 py-1 text-xs transition ${
                  draft == null
                    ? "border-black bg-neutral-100"
                    : "border-neutral-300 hover:border-neutral-500"
                }`}
              >
                — clear
              </button>
              {options.map((o) => {
                const active = o.slug === draft;
                return (
                  <button
                    key={o.slug}
                    type="button"
                    onClick={() => setDraft(o.slug)}
                    className={`rounded-full border px-2.5 py-1 text-xs transition ${
                      active
                        ? "border-black bg-black text-white"
                        : "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-500"
                    }`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center justify-end gap-1 border-t border-neutral-200 p-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded border border-neutral-300 bg-white px-2 py-0.5 text-[11px] text-neutral-700 hover:border-neutral-500"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!dirty}
              className={`rounded px-2 py-0.5 text-[11px] font-medium text-white ${
                dirty
                  ? "bg-black hover:bg-neutral-800"
                  : "bg-neutral-300"
              }`}
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
