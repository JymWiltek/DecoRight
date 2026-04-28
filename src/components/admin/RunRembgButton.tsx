"use client";

/**
 * Wave 2A · Commit 5 — Standalone "Run Background Removal" button.
 *
 * Publish-flow γ redesign: rembg moves out from "buried auto-trigger
 * under Save/Publish" to "explicit operator action with visible
 * progress". This button:
 *
 *   1. Visible only when the product has pending work — N raw +
 *      M cutout_failed > 0. When everything is already cutout_approved
 *      the operator has nothing to do here, so we render nothing.
 *   2. On click, fires `runRembgForProduct` (server action) which
 *      processes raw + cutout_failed images sequentially.
 *   3. While the action is in flight, swaps the button for an
 *      RembgProgressBanner that polls `getRembgProgress` every 5s
 *      and renders "Processing X / Y…" with a determinate-style
 *      counter. Polling stops the moment the action resolves.
 *   4. On completion: clears local state, calls router.refresh() so
 *      ProductImagesSection's server-rendered grid picks up the new
 *      states. The action's revalidatePath has already invalidated
 *      the route cache.
 *
 * Why the action runs synchronously rather than fire-and-forget:
 * useTransition gives us the right UX (button → spinner → done)
 * with one round-trip, and the rembg pipeline already serializes
 * via the api_usage advisory lock so concurrent submits would
 * queue anyway. Polling alongside is purely for the "X of Y"
 * progress indicator — the action's resolve is the ground truth.
 *
 * 5s cadence: matches MeshyStatusBanner's POLL_INTERVAL_MS (same
 * "soft polling" rationale — admin-only, dozens of sessions, 5s
 * × 30-60s typical run = 6-12 reads per click). Stops on terminal
 * state. Skips when document.hidden so a backgrounded tab burns
 * zero traffic.
 */

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  getRembgProgress,
  runRembgForProduct,
  type RembgProgressSnapshot,
  type RunRembgResult,
} from "@/app/admin/(dashboard)/products/actions";

type Props = {
  productId: string;
  /** Initial counts from the server-rendered ProductImagesSection,
   *  passed in so the button knows whether to render at all without
   *  a client-side fetch on first paint. */
  initial: RembgProgressSnapshot;
  /** False when no rembg provider is configured. We disable the
   *  button (uploading would land everything at cutout_failed) and
   *  surface a tooltip pointing the operator at the env-var fix. */
  hasAnyProvider: boolean;
};

const POLL_INTERVAL_MS = 5_000;

export default function RunRembgButton({
  productId,
  initial,
  hasAnyProvider,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [snapshot, setSnapshot] = useState<RembgProgressSnapshot>(initial);
  // We freeze the "total to process at click" so the progress
  // banner reads as a stable X / Y. Without this freeze, if a
  // cutout_failed → raw reset bumps `pending` mid-run, the
  // denominator would jitter. Plain state (not a ref) so reading
  // it during render is fine — React 19's lint disallows ref-during-
  // render, and the value participates in the progress bar anyway.
  const [runTotal, setRunTotal] = useState<number>(0);
  const [lastResult, setLastResult] = useState<RunRembgResult | null>(null);

  const remaining = snapshot.raw + snapshot.cutout_failed;
  const total = runTotal;
  const done = total > 0 ? Math.max(0, total - remaining) : 0;

  // Poll while the transition is running. Closure-stable (productId
  // only) so the interval doesn't churn between renders.
  const tick = useCallback(async () => {
    if (typeof document !== "undefined" && document.hidden) return;
    const res = await getRembgProgress(productId).catch(() => null);
    if (!res || !res.ok) return; // transient — keep previous snapshot
    setSnapshot(res.snapshot);
  }, [productId]);

  useEffect(() => {
    if (!pending) return;
    // Fire one tick immediately so the banner doesn't sit at 0/N for
    // the full 5s before the first read lands.
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) void tick();
    });
    const handle = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [pending, tick]);

  function onClick() {
    setLastResult(null);
    setRunTotal(snapshot.raw + snapshot.cutout_failed);
    startTransition(async () => {
      const res = await runRembgForProduct(productId);
      setLastResult(res);
      // Final reconcile — pull the authoritative end-state counts
      // and refresh the page so ProductImagesSection re-renders the
      // grid with the new approved cutouts.
      const after = await getRembgProgress(productId).catch(() => null);
      if (after && after.ok) setSnapshot(after.snapshot);
      router.refresh();
    });
  }

  // Steady-state render: nothing pending, nothing failed → no button.
  // The operator already has clean cutouts; the section's existing
  // "approved" pill row is enough.
  if (!pending && remaining === 0 && !lastResult) return null;

  if (pending) {
    return <ProgressBanner total={total} done={done} />;
  }

  if (lastResult && !lastResult.ok) {
    return (
      <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
        <strong>Background removal error:</strong> {lastResult.error}
      </div>
    );
  }

  // Success-with-failures takes precedence over the "Run" button so
  // the operator sees what just happened. They can click Retry on
  // the individual cards if anything failed.
  if (lastResult && lastResult.ok && lastResult.ran > 0 && remaining === 0) {
    return (
      <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        <strong>✓ Background removal complete.</strong>{" "}
        {lastResult.approved} approved
        {lastResult.failed > 0 ? `, ${lastResult.failed} failed (see Retry buttons below)` : ""}.
      </div>
    );
  }

  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm">
      <div className="text-sky-800">
        <strong>Background removal pending.</strong>{" "}
        {remaining === 1
          ? "1 image waiting"
          : `${remaining} images waiting`}
        {snapshot.cutout_failed > 0 && (
          <> ({snapshot.cutout_failed} failed previously — will retry)</>
        )}
        .
      </div>
      <button
        type="button"
        onClick={onClick}
        disabled={!hasAnyProvider}
        title={
          !hasAnyProvider
            ? "Set REPLICATE_API_TOKEN or REMOVE_BG_API_KEY first."
            : "Run rembg on all pending images"
        }
        className="shrink-0 rounded-md border border-sky-400 bg-white px-3 py-1.5 text-xs font-medium text-sky-800 transition hover:border-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Run background removal
      </button>
    </div>
  );
}

/** Progress banner — shown only while the action is in flight. */
function ProgressBanner({ total, done }: { total: number; done: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
      <div className="flex items-center gap-3">
        <Spinner />
        <div className="flex-1">
          <div className="font-semibold">Running background removal…</div>
          <div className="text-xs opacity-80">
            {done} / {total} images processed · ~10–20 s per image
          </div>
        </div>
        <span className="text-xs tabular-nums opacity-70">{pct}%</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-blue-100">
        <div
          className="h-full bg-blue-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="h-5 w-5 shrink-0 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
