"use client";

/**
 * Admin "Re-unify thumbnail" control + live preview.
 *
 * Why this exists: pg_net's `unify_thumb_on_approve` trigger fires
 * once per cutout-approval transition. If that http_post fails
 * (Vercel cold start, sharp OOM, transient 5xx) the row stays at
 * the old `thumbnail_url` until the next approval transition.
 * Operator needs a manual recovery — this is it.
 *
 * Wave 8 additions (Jym's problems 1 + 2):
 *   • Preview box (~200×200) showing the CURRENT storefront thumbnail
 *     so the operator doesn't have to leave the edit page to see what
 *     customers see. Labelled "← storefront 看到的样子".
 *   • Re-unify result is now LOUD: a fixed-bottom toast (same visual
 *     pattern as SavedToast — no new toast lib) on success/failure,
 *     and the preview swaps to the freshly-unified thumbnail in place
 *     (cache-busted by the route's versioned URL).
 *   • Failure path keeps the button as the retry affordance + names
 *     the reason in the toast.
 *
 * Mechanism: client-side fetch() POST to /api/admin/unify-thumbnail.
 * The browser carries the admin session cookie automatically; the
 * route's requireAdmin() gate accepts it. Reusing the route keeps a
 * single source of truth.
 *
 * Why <img> not next/image: the entire app renders Supabase Storage
 * thumbnails with plain <img> (ProductCard, ProductGallery,
 * ProductImagesSection). next/image isn't configured for the storage
 * domain (no remotePatterns). Matching the existing convention.
 */

import { useEffect, useState } from "react";

type Props = {
  productId: string | null;
  /** Current products.thumbnail_url — what the storefront card shows
   *  right now. Null when the product has no thumbnail yet. */
  currentThumbnailUrl?: string | null;
};

type State =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ok"; thumbnailUrl: string }
  | { kind: "error"; message: string };

type Toast =
  | { kind: "ok" }
  | { kind: "error"; message: string }
  | null;

type RouteResponse =
  | {
      ok: true;
      thumbnail_url: string;
      unified_bytes: number;
      product_bbox: { w: number; h: number };
      invalidated?: unknown;
    }
  | { ok: false; error: string; detail?: string };

export default function ReunifyThumbnailButton({
  productId,
  currentThumbnailUrl,
}: Props) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [toast, setToast] = useState<Toast>(null);
  // The preview src. Starts as the server-provided current thumbnail;
  // after a successful re-unify it swaps to the fresh versioned URL so
  // the operator sees the new result without a page reload.
  const [previewUrl, setPreviewUrl] = useState<string | null>(
    currentThumbnailUrl ?? null,
  );

  // Keep the preview in sync if the parent re-renders with a new
  // thumbnail (e.g. after a Save round-trip).
  useEffect(() => {
    if (state.kind !== "ok") {
      setPreviewUrl(currentThumbnailUrl ?? null);
    }
  }, [currentThumbnailUrl, state.kind]);

  // Auto-dismiss the toast after 4s.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const disabled = !productId || state.kind === "running";

  async function onClick() {
    if (!productId) return;
    setState({ kind: "running" });
    setToast(null);
    let res: Response;
    try {
      res = await fetch("/api/admin/unify-thumbnail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: productId }),
      });
    } catch (e) {
      const message = `network: ${e instanceof Error ? e.message : String(e)}`;
      setState({ kind: "error", message });
      setToast({ kind: "error", message });
      return;
    }
    let json: RouteResponse;
    try {
      json = (await res.json()) as RouteResponse;
    } catch {
      const message = `non-json response (HTTP ${res.status})`;
      setState({ kind: "error", message });
      setToast({ kind: "error", message });
      return;
    }
    if (!json.ok) {
      const detail = "detail" in json ? json.detail : undefined;
      const message = detail ? `${json.error}: ${detail}` : json.error;
      setState({ kind: "error", message });
      setToast({ kind: "error", message });
      return;
    }
    setState({ kind: "ok", thumbnailUrl: json.thumbnail_url });
    // Swap the preview to the fresh thumbnail. The route returns a
    // versioned (?v=…) URL so the browser fetches the new bytes even
    // though the storage path is stable.
    setPreviewUrl(json.thumbnail_url);
    setToast({ kind: "ok" });
    // Revert the button to idle after a few seconds so the operator
    // can re-run; the preview stays on the new thumbnail.
    setTimeout(() => {
      setState((s) =>
        s.kind === "ok" && s.thumbnailUrl === json.thumbnail_url
          ? { kind: "idle" }
          : s,
      );
    }, 4000);
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Current-thumbnail preview (problem 2). */}
      <div className="flex items-start gap-3">
        <div className="h-[180px] w-[180px] flex-shrink-0 overflow-hidden rounded-md border border-neutral-200 bg-neutral-50">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt="Current storefront thumbnail"
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="flex h-full items-center justify-center px-3 text-center text-[11px] text-neutral-400">
              No thumbnail yet — approve a cutout or re-unify.
            </div>
          )}
        </div>
        <div className="pt-1 text-xs text-neutral-500">
          ← storefront 看到的样子
          {state.kind === "ok" && (
            <div className="mt-1 text-emerald-700">刚刚 unify 更新 ✓</div>
          )}
        </div>
      </div>

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
            正在 unify…
          </span>
        ) : state.kind === "error" ? (
          "Retry unify"
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

      {/* Toast (problem 1) — fixed-bottom card, same pattern as
          SavedToast. Self-dismisses after 4s. */}
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
          <div
            className={`pointer-events-auto flex items-center gap-3 rounded-lg border p-4 shadow-lg ${
              toast.kind === "ok"
                ? "border-emerald-200 bg-white"
                : "border-rose-200 bg-white"
            }`}
          >
            {toast.kind === "ok" ? (
              <>
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                  ✓
                </span>
                <div className="text-sm font-medium text-neutral-900">
                  ✅ 缩略图已更新
                </div>
              </>
            ) : (
              <>
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-rose-50 text-rose-700">
                  ✕
                </span>
                <div className="text-sm">
                  <div className="font-medium text-neutral-900">
                    ❌ Unify 失败
                  </div>
                  <div className="text-xs text-neutral-500">{toast.message}</div>
                </div>
                <button
                  type="button"
                  onClick={onClick}
                  className="ml-2 rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800"
                >
                  重试
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
