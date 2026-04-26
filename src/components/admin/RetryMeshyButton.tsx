"use client";

/**
 * Phase A · Milestone 3 · Commit 3 — operator-driven Meshy retry.
 *
 * Lives inside the red MeshyStatusBanner branch. Visible iff:
 *
 *   productStatus  === 'draft'
 *   meshyStatus    === 'failed'
 *
 * The banner enforces the meshy_status=failed half (it only renders
 * the red branch in that case); this component additionally checks
 * productStatus, because the iron rule "一旦 published, 永不再跑
 * Meshy" must hold even for retries. A row could in theory be
 * status='published' AND meshy_status='failed' (manual GLB upload
 * that succeeded after a Meshy failure), and we never want a Retry
 * button on that row.
 *
 * Click flow:
 *
 *   1. useTransition — pending state disables the button + swaps
 *      the label to "重新生成中…" so the operator can't double-click.
 *   2. Call retryMeshyForProduct (server action).
 *   3. On ok → router.refresh(). The banner's own snapshot reads
 *      meshy_status='generating' on the next render and flips to
 *      blue + spinner. Polling resumes automatically (banner's
 *      useEffect re-runs when snap.status changes).
 *   4. On !ok → keep the red banner, surface the reason inline
 *      under the button. The operator can click again or fix the
 *      underlying issue (e.g. re-upload cutouts) and retry.
 *
 * Why no native form/action: this is a one-button affordance with
 * no user input. A plain onClick + server action is simpler than
 * wrapping it in <form action={…}>.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { retryMeshyForProduct } from "@/app/admin/(dashboard)/products/actions";

type Props = {
  productId: string;
  /** Defense in depth — UI also gates rendering at the parent.
   *  Typed loosely (string) to match the wider ProductStatus enum
   *  ('draft' | 'published' | 'archived' | 'link_broken'). The gate
   *  below only renders for the literal 'draft', so the other
   *  three values short-circuit to null without further branching. */
  productStatus: string;
  meshyStatus: "pending" | "generating" | "succeeded" | "failed" | null;
};

export default function RetryMeshyButton({
  productId,
  productStatus,
  meshyStatus,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Hard gate. Mirrors the server-side check in retryMeshyForProduct.
  // A `published` row never gets the button, even if meshy_status is
  // somehow 'failed' — that combo means the GLB landed via manual
  // upload, and we don't re-run Meshy on a row with a GLB.
  if (productStatus !== "draft" || meshyStatus !== "failed") return null;

  function onClick() {
    setErrorMsg(null);
    startTransition(async () => {
      // Server actions can't be called inside startTransition's sync
      // callback in earlier React versions, but in React 19 the
      // transition wrapper accepts an async function and tracks the
      // pending state across awaits. This is the canonical pattern.
      const res = await retryMeshyForProduct(productId).catch((err: unknown) => {
        return {
          ok: false as const,
          error: err instanceof Error ? err.message : "unknown error",
          code: "throw" as const,
        };
      });
      if (res.ok) {
        // Refresh so the SSR snapshot the banner mounted with is
        // replaced — the banner re-renders with meshy_status now
        // equal to 'generating' and resumes polling.
        router.refresh();
        return;
      }
      // Race-y "moved on" outcomes: just refresh — whatever the row
      // shows now is more accurate than our error state.
      if (
        res.code === "already_has_glb" ||
        res.code === "already_in_flight" ||
        res.code === "wrong_status" ||
        res.code === "wrong_meshy_status"
      ) {
        router.refresh();
        return;
      }
      setErrorMsg(res.error);
    });
  }

  return (
    <div className="mt-2 flex flex-col gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="inline-flex w-fit items-center gap-1.5 rounded-md border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 shadow-sm transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? (
          <>
            <SpinnerSmall />
            重新生成中…
          </>
        ) : (
          <>
            <RetryIcon />
            重新生成 3D 模型
          </>
        )}
      </button>
      {errorMsg && (
        <div className="text-[11px] text-rose-700">
          重试失败: {errorMsg.slice(0, 200)}
        </div>
      )}
    </div>
  );
}

function RetryIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path
        d="M3 12a9 9 0 0 1 15.5-6.3M21 4v5h-5M21 12a9 9 0 0 1-15.5 6.3M3 20v-5h5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SpinnerSmall() {
  return (
    <svg
      className="h-3.5 w-3.5 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="3"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
