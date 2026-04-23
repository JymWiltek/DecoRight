"use client";

/**
 * Click the price cell → it morphs into an inline number input.
 * Submits on blur or Enter via setProductPriceAction (single-column
 * update). Escape cancels back to the original.
 *
 * Empty input ⇒ price cleared (price_myr = NULL). The number input
 * + step="0.01" gives sensible mobile keyboards and free validation.
 */

import { useRef, useState } from "react";
import { setProductPriceAction } from "@/app/admin/(dashboard)/products/actions";
import { formatMYR } from "@/lib/format";

type Props = {
  productId: string;
  current: number | null;
};

export default function PriceCell({ productId, current }: Props) {
  const [editing, setEditing] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function start() {
    setEditing(true);
    // Microtask delay so the input is mounted before we focus it.
    queueMicrotask(() => inputRef.current?.focus());
  }

  function cancel() {
    setEditing(false);
  }

  function submit() {
    formRef.current?.requestSubmit();
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={start}
        className="text-left text-neutral-700 hover:text-black hover:underline"
        title="Click to edit"
      >
        {formatMYR(current)}
      </button>
    );
  }

  return (
    <form
      ref={formRef}
      action={setProductPriceAction}
      className="inline-flex items-center gap-1"
    >
      <input type="hidden" name="id" value={productId} />
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
    </form>
  );
}
