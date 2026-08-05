"use client";

/**
 * Storage-connectivity banner (PB). Runs in the BROWSER — it probes the same
 * Supabase Storage host a byte-PUT hits, so it reflects the operator's ACTUAL
 * upload path (a server-side check wouldn't). Jym got burned twice by a network
 * that drops the path to Supabase for seconds at a time and only found out at
 * Save; this warns him BEFORE he drags files.
 *
 *   connected    → a quiet small green dot「存储连接正常」. Re-probes every 30 s
 *                  (so a mid-drag drop flips it to red within ~30 s).
 *   disconnected → a loud red banner telling him not to drag files yet.
 *                  Re-probes every 10 s; goes green the moment it recovers.
 *   checking     → renders nothing (no flash on first paint).
 *
 * Warn-only, per Jym: it NEVER disables the form (a false-negative probe must
 * not block a Save that would actually work). Lifecycle mirrors
 * CompressionStatusBanner — document.hidden gate, self-scheduling timeout,
 * cleared on unmount.
 */

import { useEffect, useRef, useState } from "react";
import { probeStorageReachable } from "@/lib/admin/storage-probe";

const POLL_CONNECTED_MS = 30_000;
const POLL_DISCONNECTED_MS = 10_000;

type ProbeStatus = "checking" | "connected" | "disconnected";

export function useStorageProbe(): ProbeStatus {
  const [status, setStatus] = useState<ProbeStatus>("checking");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const schedule = (ms: number) => {
      timer.current = setTimeout(tick, ms);
    };

    async function tick() {
      // Don't burn probes on a backgrounded tab; re-check soon after focus.
      if (typeof document !== "undefined" && document.hidden) {
        schedule(POLL_DISCONNECTED_MS);
        return;
      }
      const ok = await probeStorageReachable();
      if (cancelled) return;
      setStatus(ok ? "connected" : "disconnected");
      schedule(ok ? POLL_CONNECTED_MS : POLL_DISCONNECTED_MS);
    }

    void tick(); // probe immediately on mount
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return status;
}

export default function StorageStatusBanner() {
  const status = useStorageProbe();

  if (status === "disconnected") {
    return (
      <div
        role="alert"
        data-testid="storage-status-banner"
        data-status="disconnected"
        className="mb-3 flex items-start gap-2 rounded-md border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800"
      >
        <span className="mt-0.5 text-base leading-none">🔴</span>
        <span>
          <strong>当前连不上存储服务器,请先不要拖入文件</strong>
          <span className="block text-xs opacity-80">
            网络恢复后此提示会自动消失(每 10 秒自动重试)。
          </span>
        </span>
      </div>
    );
  }

  if (status === "connected") {
    return (
      <div
        data-testid="storage-status-banner"
        data-status="connected"
        className="mb-3 flex items-center gap-1.5 text-xs text-emerald-600"
      >
        <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
        存储连接正常
      </div>
    );
  }

  return null; // checking — no flash
}
