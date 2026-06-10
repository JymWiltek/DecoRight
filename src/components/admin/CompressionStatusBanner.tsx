"use client";

/**
 * Wave 9 — Draco compression lifecycle banner on the product edit
 * page. Sits inside the 3D MODEL section below the dropzones.
 *
 * Visual states + behavior (mirrors MeshyStatusBanner shape):
 *
 *   compression_status = 'pending'
 *     → gray banner: "Waiting for compression to start…"
 *     → 5s polling via getCompressionStatus; usually flips to
 *       'processing' within seconds of the dispatcher firing.
 *
 *   compression_status = 'processing'
 *     → blue banner with spinner: "Compressing… (usually 30-90 s)"
 *     → 5s polling; on transition to a terminal state we call
 *       router.refresh() so glb_compressed_url shows up in the form
 *       and the dropzone "current" preview reflects the new file.
 *
 *   compression_status = 'done'
 *     → green banner: shows compressed size + ratio %
 *     → No polling.
 *
 *   compression_status = 'failed'
 *     → red banner with the error reason + Retry button
 *     → No polling. Retry calls retryGlbCompression and the row
 *       transitions back through pending → processing.
 *
 *   compression_status = null (no Wave 9 upload yet, or legacy row)
 *     → don't render. ProductForm gates on `p.compression_status`
 *       before mounting this banner.
 *
 * Polling cadence + lifecycle care matches MeshyStatusBanner:
 *   - 5 s interval (zero-traffic steady state once terminal)
 *   - document.hidden gate so backgrounded tabs don't burn cycles
 *   - clearInterval on unmount (StrictMode double-mount safe)
 *   - transient network blips keep the previous snapshot — no
 *     red flash for a missed tick.
 */

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  getCompressionStatus,
  retryGlbCompression,
  type CompressionStatusSnapshot,
} from "@/app/admin/(dashboard)/products/upload-actions";

const POLL_INTERVAL_MS = 5_000;

type Props = {
  productId: string;
  initial: CompressionStatusSnapshot;
};

export default function CompressionStatusBanner({ productId, initial }: Props) {
  const router = useRouter();
  const [snap, setSnap] = useState<CompressionStatusSnapshot>(initial);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [isRetrying, startRetry] = useTransition();
  // Track the LAST observed status so a transition into a terminal
  // state can trigger router.refresh() — see tick() below.
  const prevStatusRef = useRef(initial.status);

  const tick = useCallback(async () => {
    if (typeof document !== "undefined" && document.hidden) return;
    const res = await getCompressionStatus(productId).catch(() => null);
    if (!res || !res.ok) return; // transient — keep previous snapshot
    setSnap(res.snapshot);
    if (
      prevStatusRef.current === "processing" &&
      (res.snapshot.status === "done" || res.snapshot.status === "failed")
    ) {
      // Terminal transition. Re-render the form so glb_compressed_url,
      // compressed_size_kb, etc. show up in the dropzone preview +
      // any size/ratio chips on the page reflect the new file.
      router.refresh();
    }
    prevStatusRef.current = res.snapshot.status;
  }, [productId, router]);

  useEffect(() => {
    const isActive = snap.status === "pending" || snap.status === "processing";
    if (!isActive) return;

    // Fire one tick immediately to close any SSR → first-paint gap;
    // wrapped in a microtask so setState lands AFTER the effect
    // commits (avoids React's cascading-render warning).
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) void tick();
    });
    const handle = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [snap.status, tick]);

  function onRetry() {
    setRetryError(null);
    startRetry(async () => {
      const r = await retryGlbCompression(productId);
      if (!r.ok) {
        setRetryError(r.msg);
        return;
      }
      // Optimistically reset to 'pending' — the next poll tick will
      // catch the real state from the DB (and likely show 'processing'
      // a moment later when the dispatcher fires).
      setSnap({
        status: "pending",
        error: null,
        compressedSizeKb: null,
        originalSizeKb: snap.originalSizeKb,
      });
    });
  }

  // Quiet steady state if no compression has been attempted yet.
  if (!snap.status) return null;

  if (snap.status === "pending") {
    return (
      <Banner tone="gray">
        <ClockIcon />
        <div className="flex-1">
          <div className="font-semibold">Waiting for compression to start…</div>
          <div className="text-xs opacity-80">
            The Draco worker will pick this up shortly.
          </div>
        </div>
      </Banner>
    );
  }

  if (snap.status === "processing") {
    return (
      <Banner tone="blue">
        <Spinner />
        <div className="flex-1">
          <div className="font-semibold">Compressing .glb…</div>
          <div className="text-xs opacity-80">
            Usually 30-90 seconds. You can keep editing — Save isn&apos;t blocked.
          </div>
        </div>
      </Banner>
    );
  }

  if (snap.status === "done") {
    const ratioPct =
      snap.compressedSizeKb != null && snap.originalSizeKb
        ? Math.round(100 - (snap.compressedSizeKb / snap.originalSizeKb) * 100)
        : null;
    return (
      <Banner tone="green">
        <CheckIcon />
        <div className="flex-1">
          <div className="font-semibold">
            ✓ Compressed:{" "}
            {snap.compressedSizeKb != null
              ? `${(snap.compressedSizeKb / 1024).toFixed(2)} MB`
              : "ready"}
            {ratioPct != null ? ` · −${ratioPct}%` : ""}
          </div>
          <div className="text-xs opacity-80">
            Storefront AR uses this file. Original .glb is preserved.
          </div>
        </div>
      </Banner>
    );
  }

  // failed
  return (
    <Banner tone="red">
      <XIcon />
      <div className="flex-1">
        <div className="font-semibold">Compression failed</div>
        <div className="text-xs opacity-80">
          {(snap.error || "Unknown error").slice(0, 240)}
        </div>
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={onRetry}
            disabled={isRetrying}
            className="rounded border border-rose-300 bg-white px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60"
          >
            {isRetrying ? "Retrying…" : "Retry"}
          </button>
          <span className="text-[10px] opacity-60">
            Storefront falls back to the original .glb while this is failing.
          </span>
        </div>
        {retryError && (
          <div className="mt-1 text-[10px] text-rose-800">
            Retry error: {retryError}
          </div>
        )}
      </div>
    </Banner>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "blue" | "green" | "red" | "gray";
  children: React.ReactNode;
}) {
  const cls =
    tone === "blue"
      ? "border-blue-200 bg-blue-50 text-blue-800"
      : tone === "green"
        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
        : tone === "gray"
          ? "border-neutral-200 bg-neutral-50 text-neutral-700"
          : "border-rose-200 bg-rose-50 text-rose-800";
  return (
    <div
      className={`flex items-start gap-3 rounded-md border px-4 py-3 text-sm ${cls}`}
    >
      {children}
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="mt-0.5 h-5 w-5 shrink-0 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      className="mt-0.5 h-5 w-5 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path
        d="M5 12.5l4.5 4.5L19 7.5"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      className="mt-0.5 h-5 w-5 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      className="mt-0.5 h-5 w-5 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
