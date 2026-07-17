"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  runSpecParseAndApply,
  runSceneGenForProduct,
  type BulkAiOutcome,
} from "@/app/admin/(dashboard)/products/ai-bulk-actions";

/**
 * PB4 item 4 — the money-safe bulk-AI modal. ONE instance per trigger
 * (spec-read OR scene-gen). Enforces the flow Jym mandated:
 *   1. "Selected N products. Run 1 sample first?"  (never auto-batches)
 *   2. run 1 sample → show what got filled + REAL cost
 *   3. Jym confirms → batch the remaining N-1, with a live progress bar
 *   4. an Abort button stops the loop between products
 *   5. a quota / 429 error STOPS the whole batch immediately with a clear
 *      "OpenAI quota" message — never keeps burning
 *
 * The loop runs client-side (one server action per product) so Abort is
 * instant and cost accumulates from each call's real usage.
 */

type Kind = "specs" | "scenes";
type Phase = "confirm" | "sample" | "batching" | "done" | "stopped";

const LABEL: Record<Kind, string> = {
  specs: "Run AI · read specs",
  scenes: "Generate scene images",
};

function runOne(kind: Kind, id: string): Promise<BulkAiOutcome> {
  return kind === "specs" ? runSpecParseAndApply(id) : runSceneGenForProduct(id);
}

export default function BulkAiFlow({
  kind,
  ids,
  onClose,
}: {
  kind: Kind;
  ids: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("confirm");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0); // products processed
  const [costUsd, setCostUsd] = useState(0);
  const [results, setResults] = useState<BulkAiOutcome[]>([]);
  const [quotaHit, setQuotaHit] = useState(false);
  const abortRef = useRef(false);

  const total = ids.length;
  const sampleId = ids[0];
  const rest = ids.slice(1);

  const record = (o: BulkAiOutcome) => {
    setResults((prev) => [...prev, o]);
    if (o.ok) setCostUsd((c) => c + o.costUsd);
  };

  async function runSample() {
    setBusy(true);
    const o = await runOne(kind, sampleId);
    record(o);
    setDone(1);
    setBusy(false);
    if (!o.ok && o.code === "quota") {
      setQuotaHit(true);
      setPhase("stopped");
      return;
    }
    setPhase("sample");
  }

  async function runRest() {
    setPhase("batching");
    setBusy(true);
    for (const id of rest) {
      if (abortRef.current) break;
      const o = await runOne(kind, id);
      record(o);
      setDone((d) => d + 1);
      if (!o.ok && o.code === "quota") {
        setQuotaHit(true);
        setBusy(false);
        setPhase("stopped");
        router.refresh();
        return;
      }
    }
    setBusy(false);
    setPhase(abortRef.current ? "stopped" : "done");
    router.refresh();
  }

  function abort() {
    abortRef.current = true;
  }

  const filledCount = results.filter((r) => r.ok).length;
  const allWarnings = results.flatMap((r) => (r.ok ? r.warnings : [`${r.productId.slice(0, 8)}: ${r.error}`]));
  const sampleResult = results[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-start justify-between">
          <h2 className="text-lg font-semibold">{LABEL[kind]}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-sm text-neutral-400 hover:text-neutral-700 disabled:opacity-40"
          >
            ✕
          </button>
        </div>

        {/* Cost is ALWAYS visible once anything ran. */}
        {(phase !== "confirm" || done > 0) && (
          <div className="mb-3 rounded-md bg-neutral-50 px-3 py-2 text-sm">
            Processed <strong>{done}</strong>/{total}
            {kind === "specs" ? (
              <>
                {" · "}real OpenAI spend so far:{" "}
                <strong>${costUsd.toFixed(4)}</strong>
              </>
            ) : (
              <span className="text-neutral-500">
                {" "}· scene images are billed per-image by OpenAI (see the
                OpenAI dashboard for the exact figure)
              </span>
            )}
          </div>
        )}

        {phase === "confirm" && (
          <>
            <p className="mb-4 text-sm text-neutral-700">
              Selected <strong>{total}</strong> product{total === 1 ? "" : "s"}.
              We&rsquo;ll run <strong>1 sample first</strong> and show you the
              result + cost before touching the rest.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className={btnGhost}>
                Cancel
              </button>
              <button
                type="button"
                onClick={runSample}
                disabled={busy}
                className={btnPrimary}
              >
                {busy ? "Running sample…" : "Run 1 sample"}
              </button>
            </div>
          </>
        )}

        {phase === "sample" && sampleResult && (
          <>
            <div className="mb-4 rounded-md border border-neutral-200 p-3 text-sm">
              <div className="mb-1 font-medium">Sample result</div>
              {sampleResult.ok ? (
                <>
                  <div>
                    Filled:{" "}
                    {sampleResult.filled.length
                      ? sampleResult.filled.join(", ")
                      : "(nothing new — fields already set or unreadable)"}
                  </div>
                  {sampleResult.warnings.length > 0 && (
                    <ul className="mt-1 list-disc pl-4 text-xs text-amber-700">
                      {sampleResult.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <div className="text-rose-700">Error: {sampleResult.error}</div>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className={btnGhost}>
                Cancel
              </button>
              {rest.length > 0 ? (
                <button type="button" onClick={runRest} className={btnPrimary}>
                  Results OK — run remaining {rest.length}
                </button>
              ) : (
                <button type="button" onClick={onClose} className={btnPrimary}>
                  Done
                </button>
              )}
            </div>
          </>
        )}

        {phase === "batching" && (
          <>
            <div className="mb-3">
              <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-100">
                <div
                  className="h-full bg-black transition-all"
                  style={{ width: `${Math.round((done / total) * 100)}%` }}
                />
              </div>
            </div>
            <div className="flex justify-end">
              <button type="button" onClick={abort} className={btnGhost}>
                Abort
              </button>
            </div>
          </>
        )}

        {(phase === "done" || phase === "stopped") && (
          <>
            {quotaHit && (
              <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                <strong>Stopped: OpenAI quota / rate limit hit.</strong> The rest
                were NOT run — top up OpenAI credit and re-select them.
              </div>
            )}
            {!quotaHit && abortRef.current && (
              <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Aborted — {done}/{total} processed.
              </div>
            )}
            <div className="mb-3 text-sm">
              ✓ {filledCount} succeeded
              {kind === "specs" && (
                <>
                  {" "}· total real spend <strong>${costUsd.toFixed(4)}</strong>
                </>
              )}
            </div>
            {allWarnings.length > 0 && (
              <div className="mb-3 max-h-40 overflow-auto rounded-md bg-neutral-50 p-2 text-xs">
                <div className="mb-1 font-medium text-neutral-600">
                  Warnings ({allWarnings.length})
                </div>
                <ul className="list-disc pl-4 text-amber-700">
                  {allWarnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex justify-end">
              <button type="button" onClick={onClose} className={btnPrimary}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const btnPrimary =
  "rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50";
const btnGhost =
  "rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:border-neutral-500 disabled:opacity-50";
