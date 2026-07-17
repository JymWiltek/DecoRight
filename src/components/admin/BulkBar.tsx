"use client";

/**
 * Sticky bottom bar for bulk operations on the admin product list.
 * Listens for changes on every <input type="checkbox" name="ids">
 * inside the page-wide <form id="bulk-form">, counts checked rows,
 * and reveals itself only when at least one is selected.
 *
 * Why call server actions directly (not via form submit): React 19's
 * form-submit hijack for server actions plus Next 16's Turbopack has
 * been flaky about picking up a submitter's `formAction` when the
 * form also has checkboxes that weren't interacted with in the same
 * transition. So we read the checked ids from the DOM and invoke the
 * action as a plain async function — same pattern as StatusCell.
 *
 * Delete asks for confirm() because there's no undo at the DB level.
 * Status changes are reversible via the same bar so we don't bother.
 */

import { useEffect, useState, useTransition } from "react";
import {
  bulkDeleteAction,
  bulkUpdateStatusAction,
} from "@/app/admin/(dashboard)/products/actions";
import BulkAiFlow from "./BulkAiFlow";

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

function readCheckedIds(): string[] {
  const formEl = document.getElementById("bulk-form") as HTMLFormElement | null;
  if (!formEl) return [];
  return [
    ...formEl.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"][name="ids"]:checked',
    ),
  ].map((b) => b.value);
}

export default function BulkBar({ totalRows }: Props) {
  const [count, setCount] = useState(0);
  const [pending, startTransition] = useTransition();
  // PB3-C A — one "Run AI" panel (checkboxes inside pick specs / scenes /
  // regenerate). Replaces the earlier two-button + forced-sample flow.
  const [aiIds, setAiIds] = useState<string[] | null>(null);

  useEffect(() => {
    const formEl = document.getElementById("bulk-form") as HTMLFormElement | null;
    if (!formEl) return;
    function recount() {
      setCount(readCheckedIds().length);
    }
    formEl.addEventListener("change", recount);
    recount();
    return () => formEl.removeEventListener("change", recount);
  }, []);

  function doStatus(next: string) {
    const ids = readCheckedIds();
    if (ids.length === 0) return;
    const fd = new FormData();
    for (const id of ids) fd.append("ids", id);
    fd.set("status", next);
    startTransition(async () => {
      await bulkUpdateStatusAction(fd);
    });
  }

  function doDelete() {
    const ids = readCheckedIds();
    if (ids.length === 0) return;
    if (
      !confirm(`Permanently delete ${ids.length} product(s)? This cannot be undone.`)
    ) {
      return;
    }
    const fd = new FormData();
    for (const id of ids) fd.append("ids", id);
    startTransition(async () => {
      await bulkDeleteAction(fd);
    });
  }

  function openAi() {
    const ids = readCheckedIds();
    if (ids.length === 0) return;
    setAiIds(ids);
  }

  if (count === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200 bg-white shadow-[0_-4px_12px_-4px_rgba(0,0,0,0.08)]">
      {aiIds && <BulkAiFlow ids={aiIds} onClose={() => setAiIds(null)} />}
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-6 py-3">
        <div className="text-sm">
          <span className="font-semibold">{count}</span>{" "}
          <span className="text-neutral-500">of {totalRows} selected</span>
          {pending && (
            <span className="ml-2 text-xs text-neutral-400">saving…</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* PB3-C A — one "Run AI" button; the panel's checkboxes choose
              specs / scenes / regenerate + show a live cost estimate. */}
          <button
            type="button"
            onClick={openAi}
            className="rounded-md border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-800 transition hover:bg-sky-100"
          >
            ✨ Run AI
          </button>
          <span className="mx-1 h-5 w-px bg-neutral-200" aria-hidden />
          {STATUS_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              disabled={pending}
              onClick={() => doStatus(o.value)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition hover:opacity-80 disabled:opacity-50 ${o.tone}`}
            >
              {o.label}
            </button>
          ))}
          <button
            type="button"
            disabled={pending}
            onClick={doDelete}
            className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50"
          >
            Delete…
          </button>
        </div>
      </div>
    </div>
  );
}
