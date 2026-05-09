"use client";

/**
 * Admin "Re-unify thumbnail" button.
 *
 * Why this exists: pg_net's `unify_thumb_on_approve` trigger fires
 * once per cutout-approval transition. If that http_post fails
 * (Vercel cold start, sharp OOM, transient 5xx) the row stays at
 * the old `thumbnail_url` until the next approval transition.
 * Operator needs a manual recovery — this is it.
 *
 * Mechanism: client-side fetch() POST to the existing
 * /api/admin/unify-thumbnail route. The browser carries the admin
 * session cookie automatically; the route's requireAdmin() gate
 * accepts it. No server action wrapper needed — the route is the
 * canonical surface and reusing it keeps a single source of truth.
 *
 * UX:
 *   • Idle:   "Re-unify thumbnail"
 *   • Running: spinning + "Re-unifying…" (disabled)
 *   • Success: "Re-unified ✓" + tiny stat (cost-free, just shows the
 *              new thumbnail URL got versioned).
 *   • Error:   "Failed: <reason>" with retry available.
 *
 * Auto-clears the success state after 4 s so the button returns to
 * idle and operator can re-run if they want.
 */

import { useState } from "react";

type Props = {
  productId: string | null;
};

type State =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ok"; thumbnailUrl: string }
  | { kind: "error"; message: string };

type RouteResponse =
  | {
      ok: true;
      thumbnail_url: string;
      unified_bytes: number;
      product_bbox: { w: number; h: number };
      invalidated?: unknown;
    }
  | { ok: false; error: string; detail?: string };

export default function ReunifyThumbnailButton({ productId }: Props) {
  const [state, setState] = useState<State>({ kind: "idle" });

  const disabled = !productId || state.kind === "running";

  async function onClick() {
    if (!productId) return;
    setState({ kind: "running" });
    let res: Response;
    try {
      res = await fetch("/api/admin/unify-thumbnail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: productId }),
        // The default 'same-origin' credentials sends our session cookie.
      });
    } catch (e) {
      setState({
        kind: "error",
        message: `network: ${e instanceof Error ? e.message : String(e)}`,
      });
      return;
    }
    let json: RouteResponse;
    try {
      json = (await res.json()) as RouteResponse;
    } catch {
      setState({
        kind: "error",
        message: `non-json response (HTTP ${res.status})`,
      });
      return;
    }
    if (!json.ok) {
      const detail = "detail" in json ? json.detail : undefined;
      setState({
        kind: "error",
        message: detail ? `${json.error}: ${detail}` : json.error,
      });
      return;
    }
    setState({ kind: "ok", thumbnailUrl: json.thumbnail_url });
    // Auto-revert to idle after a few seconds so the operator can
    // re-run without a stale success badge sitting around.
    setTimeout(() => {
      setState((s) =>
        s.kind === "ok" && s.thumbnailUrl === json.thumbnail_url
          ? { kind: "idle" }
          : s,
      );
    }, 4000);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="
          self-start rounded-md border border-neutral-300 bg-white
          px-3 py-1.5 text-xs font-medium text-neutral-800 transition
          hover:border-neutral-500
          disabled:cursor-not-allowed disabled:opacity-50
        "
      >
        {state.kind === "running" ? (
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-700"
            />
            Re-unifying…
          </span>
        ) : state.kind === "ok" ? (
          <span className="inline-flex items-center gap-1.5 text-emerald-700">
            Re-unified ✓
          </span>
        ) : (
          "Re-unify thumbnail"
        )}
      </button>
      {!productId && (
        <span className="text-[11px] text-neutral-500">
          Save the product first.
        </span>
      )}
      {state.kind === "error" && (
        <div className="rounded-md bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
          {state.message}
        </div>
      )}
      {state.kind === "ok" && (
        <span className="text-[11px] text-neutral-500">
          Storefront cache invalidated; fresh thumbnail on next page load.
        </span>
      )}
    </div>
  );
}
