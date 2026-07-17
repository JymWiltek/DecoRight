"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  runSpecParseAndApply,
  runSceneGenForProduct,
  getAiPanelInfo,
  type BulkAiOutcome,
  type AiPanelInfo,
} from "@/app/admin/(dashboard)/products/ai-bulk-actions";

/**
 * PB3-C A — the single "✨ Run AI" panel. Operator feedback killed the old
 * two-button + forced-sample flow. Now: one panel with checkboxes, a LIVE cost
 * estimate that tracks the selection, and one Run that goes straight to the
 * batch (selecting N = running N — the operator tests by selecting 1 himself).
 *   ☑ Read specs & fill fields        (default on — cheap)
 *   ☐ Generate scene images           (default off — pricey)
 *   ☐ Regenerate existing scene images (default off — overwrite)
 * Kept from before: progress bar, Abort, quota/429 hard-stop, and the REAL
 * total spend (from OpenAI usage, never estimated).
 */

type Phase = "config" | "running" | "done" | "stopped";

export default function BulkAiFlow({
  ids,
  onClose,
}: {
  ids: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const total = ids.length;

  const [info, setInfo] = useState<AiPanelInfo | null>(null);
  const [readSpecs, setReadSpecs] = useState(true);
  const [genScenes, setGenScenes] = useState(false);
  const [regenScenes, setRegenScenes] = useState(false);

  const [phase, setPhase] = useState<Phase>("config");
  const [done, setDone] = useState(0);
  const [costUsd, setCostUsd] = useState(0);
  const [results, setResults] = useState<BulkAiOutcome[]>([]);
  const [quotaHit, setQuotaHit] = useState(false);
  const abortRef = useRef(false);

  useEffect(() => {
    let live = true;
    getAiPanelInfo(ids).then((i) => live && setInfo(i));
    return () => {
      live = false;
    };
  }, [ids]);

  // ── Live estimate ────────────────────────────────────────────────
  const sceneTargets = genScenes
    ? regenScenes
      ? total
      : total - (info?.withSceneCount ?? 0)
    : 0;
  const specEst =
    readSpecs && info?.specUnitUsd != null ? info.specUnitUsd * total : 0;
  const sceneEst =
    genScenes && info?.sceneUnitUsd != null
      ? info.sceneUnitUsd * sceneTargets
      : 0;
  const estKnown = specEst + sceneEst;
  const specUnknown = readSpecs && info != null && info.specUnitUsd == null;
  const sceneUnknown = genScenes && info != null && info.sceneUnitUsd == null;

  const record = (o: BulkAiOutcome) => {
    setResults((prev) => [...prev, o]);
    if (o.ok) setCostUsd((c) => c + o.costUsd);
  };

  async function run() {
    if (!readSpecs && !genScenes) return;
    setPhase("running");
    for (let i = 0; i < ids.length; i++) {
      if (abortRef.current) break;
      const id = ids[i];
      if (readSpecs) {
        const o = await runSpecParseAndApply(id);
        record(o);
        if (!o.ok && o.code === "quota") return stop();
      }
      if (genScenes && !abortRef.current) {
        const o = await runSceneGenForProduct(id, regenScenes);
        record(o);
        if (!o.ok && o.code === "quota") return stop();
      }
      setDone(i + 1);
    }
    setPhase(abortRef.current ? "stopped" : "done");
    router.refresh();
  }

  function stop() {
    setQuotaHit(true);
    setDone((d) => d); // freeze
    setPhase("stopped");
    router.refresh();
  }

  const succeeded = results.filter((r) => r.ok).length;
  const warnings = results.flatMap((r) =>
    r.ok ? r.warnings : [`${r.productId.slice(0, 8)}: ${r.error}`],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-start justify-between">
          <h2 className="text-lg font-semibold">✨ Run AI · {total} product{total === 1 ? "" : "s"}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={phase === "running"}
            className="text-sm text-neutral-400 hover:text-neutral-700 disabled:opacity-40"
          >
            ✕
          </button>
        </div>

        {phase === "config" && (
          <>
            <div className="space-y-2">
              <label className="flex items-start gap-2 rounded-md border border-neutral-200 p-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={readSpecs}
                  onChange={(e) => setReadSpecs(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">Read specs &amp; fill fields</span>
                  <span className="block text-xs text-neutral-500">
                    Cheap. Reads photos / spec sheets → name, type, dimensions,
                    description, etc. (empty fields only).
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 rounded-md border border-neutral-200 p-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={genScenes}
                  onChange={(e) => setGenScenes(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">Generate scene images</span>{" "}
                  <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-800">pricey</span>
                  <span className="block text-xs text-neutral-500">
                    Puts the product into a styled room scene.
                  </span>
                </span>
              </label>
              <label
                className={`flex items-start gap-2 rounded-md border border-neutral-200 p-2.5 text-sm ${genScenes ? "" : "opacity-50"}`}
              >
                <input
                  type="checkbox"
                  checked={regenScenes}
                  disabled={!genScenes}
                  onChange={(e) => setRegenScenes(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">Regenerate existing scene images</span>
                  <span className="block text-xs text-neutral-500">
                    Off: products that already have a scene are skipped. On:
                    overwrite them.
                  </span>
                </span>
              </label>
            </div>

            {/* Live estimate. */}
            <div className="mt-3 rounded-md bg-neutral-50 px-3 py-2 text-sm">
              {info == null ? (
                <span className="text-neutral-400">Estimating…</span>
              ) : (
                <>
                  Estimated spend:{" "}
                  <strong>${estKnown.toFixed(4)}</strong>
                  {readSpecs && (
                    <span className="block text-xs text-neutral-500">
                      specs: {total} ×{" "}
                      {info.specUnitUsd != null
                        ? `$${info.specUnitUsd.toFixed(4)}`
                        : "— (no history yet)"}
                    </span>
                  )}
                  {genScenes && (
                    <span className="block text-xs text-neutral-500">
                      scenes: {sceneTargets} ×{" "}
                      {info.sceneUnitUsd != null
                        ? `$${info.sceneUnitUsd.toFixed(4)}`
                        : "per image (billed by OpenAI — see dashboard)"}
                      {!regenScenes && (info.withSceneCount ?? 0) > 0 && (
                        <> · {info.withSceneCount} already have a scene (skipped)</>
                      )}
                    </span>
                  )}
                  {(specUnknown || sceneUnknown) && (
                    <span className="block text-xs text-amber-600">
                      Actual total is read from OpenAI usage after the run.
                    </span>
                  )}
                </>
              )}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={onClose} className={btnGhost}>
                Cancel
              </button>
              <button
                type="button"
                onClick={run}
                disabled={!readSpecs && !genScenes}
                className={btnPrimary}
              >
                Run
              </button>
            </div>
          </>
        )}

        {phase === "running" && (
          <>
            <div className="mb-2 text-sm">
              Processing {done}/{total}
              {readSpecs && (
                <> · real spend <strong>${costUsd.toFixed(4)}</strong></>
              )}
            </div>
            <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-neutral-100">
              <div
                className="h-full bg-black transition-all"
                style={{ width: `${Math.round((done / total) * 100)}%` }}
              />
            </div>
            <div className="flex justify-end">
              <button type="button" onClick={() => (abortRef.current = true)} className={btnGhost}>
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
              ✓ {succeeded} step{succeeded === 1 ? "" : "s"} succeeded · total real
              spend <strong>${costUsd.toFixed(4)}</strong>
              {genScenes && (
                <span className="block text-xs text-neutral-500">
                  (scene images are billed per image — check the OpenAI dashboard
                  for that portion)
                </span>
              )}
            </div>
            {warnings.length > 0 && (
              <div className="mb-3 max-h-40 overflow-auto rounded-md bg-neutral-50 p-2 text-xs">
                <div className="mb-1 font-medium text-neutral-600">
                  Notes ({warnings.length})
                </div>
                <ul className="list-disc pl-4 text-amber-700">
                  {warnings.map((w, i) => (
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
