"use client";

import { useEffect, useState } from "react";

/**
 * "Backend updated — reload before your next upload" banner (PB #34).
 *
 * WHY: a Vercel redeploy invalidates the Server Action references baked into an
 * already-loaded admin page. The next upload's action POST then fails with the
 * useless "Failed to fetch". This is the true cause of the bulk-create failures
 * (NOT session expiry — that cookie is a 7-day static HMAC with no refresh).
 *
 * The page renders with `currentVersion` (the deploy id at load time). We poll
 * /api/deploy-version (served by whatever deployment is now live) on an interval
 * and on window focus; a mismatch means a new deploy is up → show a sticky
 * banner telling the operator to finish the batch, then reload. Never fires
 * locally ("dev" === "dev").
 */
export default function DeployStaleBanner({
  currentVersion,
  pollMs = 60_000,
}: {
  currentVersion: string;
  pollMs?: number;
}) {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (stale) return; // once stale, stop polling
    let live = true;
    const check = async () => {
      try {
        const r = await fetch("/api/deploy-version", { cache: "no-store" });
        if (!r.ok) return;
        const { version } = (await r.json()) as { version?: string };
        if (
          live &&
          typeof version === "string" &&
          version !== "dev" &&
          version !== currentVersion
        ) {
          setStale(true);
        }
      } catch {
        // network blip — ignore, try again next tick
      }
    };
    const id = setInterval(check, pollMs);
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => {
      live = false;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [currentVersion, pollMs, stale]);

  if (!stale) return null;

  return (
    <div className="sticky top-0 z-40 mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      <span>
        <strong>后台已更新。</strong>
        请先完成本批上传,然后刷新页面 —— 否则上传可能失败(「Failed to fetch」)。
      </span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="shrink-0 rounded-md border border-amber-400 bg-white px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100"
      >
        刷新页面
      </button>
    </div>
  );
}
