"use client";

/**
 * Phase A · Milestone 3 · Commit 2 — Meshy generation status banner.
 *
 * Sits at the top of the product Edit page. Three visual states +
 * a "no banner" mode:
 *
 *   meshy_status = 'generating' (or 'pending')
 *     → blue banner with spinner: "3D 模型生成中..."
 *     → 5s soft polling via getMeshyStatus until status changes
 *
 *   meshy_status = 'succeeded'
 *     → green banner: "✓ 3D 模型已生成 — Live now"
 *     → on transition from 'generating', router.refresh() so the
 *       form re-reads the row (now with glb_url + product status
 *       'published' if the worker promoted it)
 *
 *   meshy_status = 'failed'
 *     → red banner with the error reason
 *     → no polling (terminal); Retry button comes in Commit 3
 *
 *   meshy_status = null OR (status = 'succeeded' AND product is
 *     already 'published' from a prior session) → don't render
 *     unless the operator just kicked off (`?meshy=started` query
 *     param signals that). Quiet UI for the steady state.
 *
 * Why "soft" polling and not WebSocket / SSE / Supabase Realtime:
 *   - Phase A targets dozens of admin sessions, not thousands. A
 *     5s poll while a single tab is open is ~720 calls/hour — well
 *     under any practical Postgres budget.
 *   - The cron worker (Commit 5) writes the row at most every 60s,
 *     so a 5s probe burns at most 12 reads per row update — cheap.
 *   - Realtime requires a separate channel + RLS policy for
 *     authenticated subscribers. Not worth the surface area when
 *     a setInterval gets the operator the same UX.
 *   - Polling stops the moment status flips to a terminal value,
 *     so the steady state is zero traffic.
 *
 * Lifecycle care:
 *   - clearInterval on unmount (StrictMode double-mount in dev
 *     would leak intervals otherwise).
 *   - Don't poll if document.hidden — saves cycles on a backgrounded
 *     tab. Page Visibility API is in every modern browser.
 *   - On error from getMeshyStatus (network blip, server hiccup),
 *     just keep the previous snapshot and try again next tick. No
 *     red flash for transient failures.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getMeshyStatus, type MeshyStatusSnapshot } from "@/app/admin/(dashboard)/products/actions";
import RetryMeshyButton from "./RetryMeshyButton";

type Props = {
  productId: string;
  /** Server-rendered initial state — avoids a flash of "loading" on
   *  first paint. The component continues from here. */
  initial: MeshyStatusSnapshot;
  /** True iff the URL carries `?meshy=started` — i.e. the operator
   *  just clicked Publish and we held the row at draft to kick off
   *  Meshy. Forces the banner to show even if the snapshot is still
   *  null (the kick-off DB write may not have propagated yet, rare). */
  justKickedOff: boolean;
  /** Phase 1 收尾 P0-4: pre-flight refusal that didn't make it as
   *  far as a DB write. updateProduct/kickOffMeshyForProduct redirect
   *  here with `?err=meshy_<reason>&msg=<detail>`; the page extracts
   *  the suffix and passes it in. One-shot banner — no DB lifecycle,
   *  reloading the page (no err= in URL) clears it.
   *
   *  `no_cutouts` is intentionally not handled here: the rembg failure
   *  banner already covers that case ("3 images failed background
   *  removal"). Surfacing both would just nag the operator twice. */
  blockedReason?: string;
  blockedDetail?: string;
};

const POLL_INTERVAL_MS = 5_000;

export default function MeshyStatusBanner({
  productId,
  initial,
  justKickedOff,
  blockedReason,
  blockedDetail,
}: Props) {
  const router = useRouter();
  const [snap, setSnap] = useState<MeshyStatusSnapshot>(initial);
  // Track whether the LAST observed status was 'generating'. When it
  // flips to a terminal state (succeeded / failed) we trigger a full
  // router.refresh() so the rest of the form (glb_url field, status
  // pill) re-reads from the server.
  const prevStatusRef = useRef(initial.status);

  const tick = useCallback(async () => {
    if (typeof document !== "undefined" && document.hidden) return;
    const res = await getMeshyStatus(productId).catch(() => null);
    if (!res || !res.ok) return; // transient — keep previous snapshot
    setSnap(res.snapshot);
    if (
      prevStatusRef.current === "generating" &&
      (res.snapshot.status === "succeeded" || res.snapshot.status === "failed")
    ) {
      // Transitioned to a terminal state. Refresh the route so the
      // form re-reads the row (glb_url, product status, etc.) without
      // requiring the operator to F5.
      router.refresh();
    }
    prevStatusRef.current = res.snapshot.status;
  }, [productId, router]);

  useEffect(() => {
    // Only set up the interval when polling makes sense.
    const isActive = snap.status === "generating" || snap.status === "pending";
    if (!isActive) return;

    // Fire one tick immediately (after commit) to close any gap
    // between SSR snapshot and current DB state — the cron worker may
    // have flipped status during server render → first paint, so we
    // don't want the operator staring at a stale "generating" for the
    // full 5s POLL_INTERVAL. Wrapped in a microtask so setState lands
    // *after* the effect commits (avoids the cascading-render warning
    // from calling setState synchronously inside an effect body).
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) void tick();
    });
    const handle = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
    // We intentionally re-init the interval when status changes so a
    // 'failed' → (manual SQL fix) → 'generating' transition picks
    // back up. snap.status is the right dependency.
  }, [snap.status, tick]);

  // P0-4: pre-flight refusal banner. Sits ABOVE the lifecycle-status
  // checks because a refusal means the lifecycle didn't even start
  // (no DB write happened); without this branch the operator gets
  // zero visual feedback that Publish silently bypassed Meshy.
  // `no_cutouts` is filtered upstream at the page level — see Props
  // doc — so we don't have to special-case it here.
  if (blockedReason && !snap.status) {
    return (
      <Banner tone="amber">
        <WarnIcon />
        <div className="flex-1">
          <div className="font-semibold">
            {meshyBlockedTitle(blockedReason)}
          </div>
          <div className="text-xs opacity-80">
            {meshyBlockedDetail(blockedReason, blockedDetail)}
          </div>
        </div>
      </Banner>
    );
  }

  // Quiet steady state: no banner if we're not in any Meshy lifecycle.
  if (!snap.status && !justKickedOff) return null;

  if (snap.status === "generating" || snap.status === "pending" || (justKickedOff && !snap.status)) {
    return (
      <Banner tone="blue">
        <Spinner />
        <div className="flex-1">
          <div className="font-semibold">3D 模型生成中…</div>
          <div className="text-xs opacity-80">
            通常需要 2–3 分钟。后台自动跑，关闭窗口也不影响。
            {snap.attempts > 0 && (
              <span className="ml-2">第 {snap.attempts + 1} 次尝试</span>
            )}
          </div>
        </div>
      </Banner>
    );
  }

  if (snap.status === "succeeded") {
    const isLive = snap.productStatus === "published";
    return (
      <Banner tone="green">
        <CheckIcon />
        <div className="flex-1">
          <div className="font-semibold">
            ✓ 3D 模型已生成{isLive ? " — Live now" : ""}
          </div>
          <div className="text-xs opacity-80">
            {isLive
              ? "产品已自动上线，前台可见。"
              : "GLB 已就绪，产品状态正在更新…"}
          </div>
        </div>
      </Banner>
    );
  }

  if (snap.status === "failed") {
    return (
      <Banner tone="red">
        <XIcon />
        <div className="flex-1">
          <div className="font-semibold">3D 模型生成失败</div>
          <div className="text-xs opacity-80">
            {snap.error?.slice(0, 240) || "未知错误"}
          </div>
          <div className="text-[10px] opacity-60 mt-1">
            尝试次数: {snap.attempts}/3
          </div>
          {/* Retry surface — only renders when productStatus='draft'
              AND meshy_status='failed'. The button itself enforces
              both, so a row that's somehow succeeded-via-manual-upload
              (status='published' + meshy_status='failed') gets the
              red banner without a Retry, which is correct: GLB
              already exists, no re-run allowed. */}
          <RetryMeshyButton
            productId={productId}
            productStatus={snap.productStatus}
            meshyStatus={snap.status}
          />
        </div>
      </Banner>
    );
  }

  return null;
}

function Banner({
  tone,
  children,
}: {
  tone: "blue" | "green" | "red" | "amber";
  children: React.ReactNode;
}) {
  const cls =
    tone === "blue"
      ? "border-blue-200 bg-blue-50 text-blue-800"
      : tone === "green"
        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
        : tone === "amber"
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : "border-rose-200 bg-rose-50 text-rose-800";
  return (
    <div className={`flex items-start gap-3 rounded-md border px-4 py-3 text-sm ${cls}`}>
      {children}
    </div>
  );
}

/** Pre-flight refusal headline. The reason values mirror
 *  `KickOffErrorCode` in src/lib/meshy-kickoff.ts; updateProduct
 *  redirects with `?err=meshy_<reason>` so the page sees them
 *  prefix-stripped. Default falls back to a generic warning so an
 *  unknown future reason still produces a banner instead of silence. */
function meshyBlockedTitle(reason: string): string {
  switch (reason) {
    case "already_has_glb":
      return "3D model already attached";
    case "already_in_flight":
      return "3D generation already running";
    case "meshy_not_configured":
      return "Meshy not configured";
    case "quota_exceeded":
      return "Meshy daily quota reached";
    case "meshy_api_error":
      return "Meshy API error";
    case "product_missing":
    case "db_error":
      return "3D generation skipped";
    default:
      return "3D generation skipped";
  }
}

function meshyBlockedDetail(reason: string, detail: string | undefined): string {
  switch (reason) {
    case "already_has_glb":
      return "This product already has a GLB. Delete it first if you want to regenerate.";
    case "already_in_flight":
      return "Wait for the current Meshy task to finish before re-publishing.";
    case "meshy_not_configured":
      return "Set MESHY_API_KEY in Vercel env vars and redeploy.";
    case "quota_exceeded":
      return "Try again tomorrow or raise the daily cap in app_config.";
    case "meshy_api_error":
      return detail ? detail.slice(0, 200) : "Try again in a few minutes.";
    case "product_missing":
    case "db_error":
      return "Internal pre-flight check failed. Refresh and try Publish again.";
    default:
      return detail ? detail.slice(0, 200) : "See logs for details.";
  }
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

function WarnIcon() {
  return (
    <svg
      className="mt-0.5 h-5 w-5 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path
        d="M12 3l10 18H2L12 3z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M12 10v5M12 18.5v.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
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
