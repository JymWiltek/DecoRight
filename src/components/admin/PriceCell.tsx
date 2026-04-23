"use client";

/**
 * Click the price cell → it morphs into an inline number input
 * flanked by Save / Cancel buttons. Only an explicit Save writes
 * back — blur no longer submits (operator might scroll to read
 * another row mid-edit without wanting to commit). Enter = Save,
 * Escape = Cancel.
 *
 * Why no <form>: /admin's table is wrapped in <form id="bulk-form">
 * for bulk ops, so nesting forms is invalid HTML. We call the
 * action directly — React 19 server actions are plain async
 * functions.
 *
 * Empty input ⇒ price cleared (price_myr = NULL). The number input
 * + step="0.01" gives sensible mobile keyboards and free validation.
 */

import { useRef, useState, useTransition } from "react";
import { setProductPriceAction } from "@/app/admin/(dashboard)/products/actions";
import { formatMYR } from "@/lib/format";

type Props = {
  productId: string;
  current: number | null;
};

export default function PriceCell({ productId, current }: Props) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function start() {
    setEditing(true);
    queueMicrotask(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }

  function cancel() {
    setEditing(false);
  }

  function save() {
    const raw = inputRef.current?.value ?? "";
    const fd = new FormData();
    fd.set("id", productId);
    fd.set("price_myr", raw);
    setEditing(false);
    startTransition(async () => {
      await setProductPriceAction(fd);
    });
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={start}
        disabled={pending}
        className={`text-left text-neutral-700 hover:text-black hover:underline ${
          pending ? "opacity-50" : ""
        }`}
        title="Click to edit"
      >
        {formatMYR(current)}
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        ref={inputRef}
        type="number"
        step="0.01"
        name="price_myr"
        defaultValue={current ?? ""}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        className="w-24 rounded border border-neutral-300 px-2 py-0.5 text-sm focus:border-black focus:outline-none"
      />
      <button
        type="button"
        onClick={save}
        className="rounded bg-black px-2 py-0.5 text-[11px] font-medium text-white hover:bg-neutral-800"
      >
        Save
      </button>
      <button
        type="button"
        onClick={cancel}
        className="rounded border border-neutral-300 bg-white px-2 py-0.5 text-[11px] text-neutral-700 hover:border-neutral-500"
      >
        Cancel
      </button>
    </span>
  );
}
