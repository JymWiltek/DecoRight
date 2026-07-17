"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  parseImportFile,
  applyImport,
  type ImportPlan,
  type ApplyResult,
} from "../import-actions";

/**
 * Excel import — three steps: upload → PREVIEW (before→after diff + blocked
 * rows) → confirm → write. Nothing hits the DB until Jym clicks Confirm; the
 * whole point is he eyeballs every change first (his iron rule for bulk ops).
 */
export default function ImportClient() {
  const router = useRouter();
  const [phase, setPhase] = useState<"upload" | "preview" | "done">("upload");
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [pending, start] = useTransition();

  function analyze(fd: FormData) {
    setError(null);
    start(async () => {
      const res = await parseImportFile(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPlan(res);
      setPhase("preview");
    });
  }

  function confirmWrite() {
    if (!plan) return;
    start(async () => {
      const res = await applyImport(plan.toUpdate);
      setResult(res);
      setPhase("done");
      router.refresh();
    });
  }

  function reset() {
    setPlan(null);
    setResult(null);
    setError(null);
    setPhase("upload");
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {phase === "upload" && (
        <form
          action={analyze}
          className="rounded-lg border border-neutral-200 bg-white p-5"
        >
          <p className="mb-3 text-sm text-neutral-600">
            Upload the edited <strong>.xlsx</strong> or <strong>.csv</strong>{" "}
            (Google Sheets export works). You&rsquo;ll see a preview of every
            change before anything is saved.
          </p>
          <input
            type="file"
            name="file"
            accept=".xlsx,.csv"
            required
            className="block text-sm"
          />
          <button
            type="submit"
            disabled={pending}
            className="mt-4 rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50"
          >
            {pending ? "Analyzing…" : "Analyze file"}
          </button>
        </form>
      )}

      {phase === "preview" && plan && (
        <PreviewPane
          plan={plan}
          pending={pending}
          onConfirm={confirmWrite}
          onCancel={reset}
        />
      )}

      {phase === "done" && result && (
        <div className="space-y-4">
          {result.ok ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              ✓ Updated <strong>{result.updated}</strong> product
              {result.updated === 1 ? "" : "s"}.
              {result.skipped.length > 0 && (
                <div className="mt-2 text-amber-700">
                  {result.skipped.length} skipped during write:
                  <ul className="ml-4 list-disc">
                    {result.skipped.map((s, i) => (
                      <li key={i}>
                        {s.productId.slice(0, 8)} — {s.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {result.error}
            </div>
          )}
          <button
            onClick={reset}
            className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:border-neutral-500"
          >
            Import another file
          </button>
        </div>
      )}
    </div>
  );
}

function PreviewPane({
  plan,
  pending,
  onConfirm,
  onCancel,
}: {
  plan: ImportPlan;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { stats, toUpdate, blocked, ignoredReadOnly } = plan;
  return (
    <div className="space-y-5">
      {/* Sticky action bar so Confirm/Cancel are always reachable even with a
          long change list. */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="text-sm text-neutral-700">
          <strong>{stats.changedProducts}</strong> product
          {stats.changedProducts === 1 ? "" : "s"} will change
          <span className="text-neutral-400"> · </span>
          {stats.unchanged} unchanged
          {stats.blocked > 0 && (
            <>
              <span className="text-neutral-400"> · </span>
              <span className="text-rose-600">{stats.blocked} blocked</span>
            </>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={pending}
            className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:border-neutral-500 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={pending || stats.changedProducts === 0}
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending
              ? "Writing…"
              : `Confirm & write ${stats.changedProducts} product${stats.changedProducts === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>

      {/* Blocked rows — surfaced FIRST so they aren't missed. */}
      {blocked.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-rose-700">
            Blocked ({blocked.length}) — not imported
          </h3>
          <div className="space-y-1.5">
            {blocked.map((b, i) => (
              <div
                key={i}
                className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"
              >
                <span className="font-medium">Row {b.rowNumber}</span> ·{" "}
                <span className="font-mono">{b.identity}</span> — {b.reason}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Ignored read-only edits. */}
      {ignoredReadOnly.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-amber-700">
            Ignored read-only edits ({ignoredReadOnly.length})
          </h3>
          <div className="space-y-1.5">
            {ignoredReadOnly.map((g, i) => (
              <div
                key={i}
                className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
              >
                <span className="font-medium">Row {g.rowNumber}</span> ·{" "}
                {g.productLabel} — changed <strong>{g.col}</strong> to &ldquo;
                {g.attempted}&rdquo; but that column is read-only (kept &ldquo;
                {g.current}&rdquo;).
                {g.col === "status" && (
                  <span className="ml-1">
                    Publish via the admin bulk button — it runs the required
                    gates.
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Changes. */}
      {toUpdate.length > 0 ? (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-neutral-800">
            Changes ({toUpdate.length})
          </h3>
          <div className="space-y-2">
            {toUpdate.map((e) => (
              <div
                key={e.productId}
                className="rounded-md border border-neutral-200 bg-white px-3 py-2.5"
              >
                <div className="flex items-center gap-2">
                  <a
                    href={e.productUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-neutral-900 hover:underline"
                  >
                    {e.productName}
                  </a>
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] text-neutral-500">
                    matched by {e.matchedBy}
                  </span>
                </div>
                <ul className="mt-1.5 space-y-0.5 text-xs">
                  {e.changes.map((c, i) => (
                    <li key={i} className="flex flex-wrap items-baseline gap-1.5">
                      <span className="font-medium text-neutral-500">
                        {c.label}:
                      </span>
                      <span className="rounded bg-rose-50 px-1 text-rose-700 line-through">
                        {c.before || "(empty)"}
                      </span>
                      <span aria-hidden className="text-neutral-400">
                        →
                      </span>
                      <span className="rounded bg-emerald-50 px-1 text-emerald-700">
                        {c.after || "(empty)"}
                      </span>
                    </li>
                  ))}
                </ul>
                {e.warnings.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-[11px] text-amber-700">
                    {e.warnings.map((w, i) => (
                      <li key={i}>⚠ {w}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </section>
      ) : (
        <div className="rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-500">
          No editable changes detected in this file.
        </div>
      )}
    </div>
  );
}
