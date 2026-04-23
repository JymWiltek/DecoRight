"use client";

/**
 * Click the price cell → it morphs into an inline number input.
 * Submits on blur or Enter; calls setProductPriceAction directly
 * (single-column update). Escape cancels back to the original.
 *
 * Why no <form>: /admin's table is wrapped in <form id="bulk-form">
 * for bulk ops, so nesting another form here is invalid HTML. We
 * call the action directly via onBlur/Enter — in React 19 server
 * actions are plain async functions.
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
    queueMicrotask(() => inputRef.current?.focus());
  }

  function cancel() {
    setEditing(false);
  }

  function submit() {
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
    <input
      ref={inputRef}
      type="number"
      step="0.01"
      name="price_myr"
      defaultValue={current ?? ""}
      onBlur={submit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          submit();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
      }}
      className="w-24 rounded border border-neutral-300 px-2 py-0.5 text-sm focus:border-black focus:outline-none"
    />
  );
}
