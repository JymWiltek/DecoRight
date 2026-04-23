"use client";

/**
 * Sticky bottom bar for bulk operations on the admin product list.
 * Listens for changes on every <input type="checkbox" name="ids">
 * inside the page-wide <form id="bulk-form">, counts checked rows,
 * and reveals itself only when at least one is selected.
 *
 * "Set draft" / "Set published" / "Set archived" / "Delete" buttons
 * each set a hidden marker input then submit the bulk form to the
 * appropriate server action. We use a single form (rather than four
 * forms each repeating the ids) because the user can only click one
 * action button at a time and the action is dispatched per-button
 * via formAction= override.
 *
 * Delete asks for confirm() because there's no undo at the DB level.
 * Status changes are reversible via the same bar so we don't bother.
 */

import { useEffect, useState } from "react";
import {
  bulkDeleteAction,
  bulkUpdateStatusAction,
} from "@/app/admin/(dashboard)/products/actions";

type Props = {
  /** Total row count, shown as "N of M selected" for context. */
  totalRows: number;
};

const STATUS_OPTIONS: { value: string; label: string; tone: string }[] = [
  { value: "draft", label: "→ Draft", tone: "bg-neutral-100 text-neutral-700" },
  {
    value: "published",
    label: "→ Published",
    tone: "bg-emerald-100 text-emerald-700",
  },
  {
    value: "archived",
    label: "→ Archived",
    tone: "bg-amber-100 text-amber-800",
  },
];

export default function BulkBar({ totalRows }: Props) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const formEl = document.getElementById("bulk-form") as HTMLFormElement | null;
    if (!formEl) return;
    function recount() {
      const boxes = formEl!.querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"][name="ids"]',
      );
      let n = 0;
      for (const b of boxes) if (b.checked) n += 1;
      setCount(n);
    }
    formEl.addEventListener("change", recount);
    recount();
    return () => formEl.removeEventListener("change", recount);
  }, []);

  function confirmDelete(e: React.FormEvent<HTMLButtonElement>) {
    if (
      !confirm(
        `Permanently delete ${count} product(s)? This cannot be undone.`,
      )
    ) {
      e.preventDefault();
    }
  }

  if (count === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200 bg-white shadow-[0_-4px_12px_-4px_rgba(0,0,0,0.08)]">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-6 py-3">
        <div className="text-sm">
          <span className="font-semibold">{count}</span>{" "}
          <span className="text-neutral-500">
            of {totalRows} selected
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {STATUS_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="submit"
              form="bulk-form"
              formAction={bulkUpdateStatusAction}
              name="status"
              value={o.value}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition hover:opacity-80 ${o.tone}`}
            >
              {o.label}
            </button>
          ))}
          <button
            type="submit"
            form="bulk-form"
            formAction={bulkDeleteAction}
            onClick={confirmDelete}
            className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700"
          >
            Delete…
          </button>
        </div>
      </div>
    </div>
  );
}
