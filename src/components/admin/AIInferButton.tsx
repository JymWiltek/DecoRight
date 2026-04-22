"use client";

import { useState, useTransition } from "react";
import { runAiInfer } from "@/app/admin/(dashboard)/products/actions";

export default function AIInferButton() {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const onClick = () => {
    const form = document.querySelector<HTMLFormElement>("form[data-product-form]");
    if (!form) return;
    const fd = new FormData(form);
    startTransition(async () => {
      const res = await runAiInfer(fd);
      if (res.inferredKeys.length === 0) {
        setMsg(res.note ?? "AI inference reachable, but no fields to fill.");
      } else {
        setMsg(`AI filled: ${res.inferredKeys.join(", ")}`);
      }
    });
  };

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="self-start rounded-md border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs text-sky-700 hover:border-sky-500 disabled:opacity-50"
      >
        {pending ? "Inferring…" : "AI autofill (enabled in Phase 3)"}
      </button>
      {msg && <div className="text-xs text-neutral-500">{msg}</div>}
    </div>
  );
}
