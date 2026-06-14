"use client";

/**
 * Admin "Fit & center (keep background)" control.
 *
 * Re-frames the storefront card thumbnail so the product is centered and
 * fills ~65% of a 3:4 crop, WITHOUT removing the original scene
 * background. The counterpart to ReunifyThumbnailButton (which puts the
 * cutout on a white canvas). Use this for Wiltek's rendered scene photos
 * where the background is wanted but the product is off-center / too
 * small / too large in the frame.
 *
 * Mechanism: client fetch() POST to /api/admin/fit-center (carries the
 * admin cookie). The route runs rembg ONCE only to locate the product,
 * then crops the original scene — so one provider credit is spent per
 * click (manual / opt-in, per Wave 11b). On success it swaps the live
 * preview to the freshly framed thumbnail.
 *
 * Plain <img> (not next/image) to match the rest of the app's Storage
 * thumbnails.
 */

import { useEffect, useState } from "react";

type Props = {
  productId: string | null;
  /** Current products.thumbnail_url — what the card shows now. */
  currentThumbnailUrl?: string | null;
};

type State =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ok"; thumbnailUrl: string; coverage: number; fallback: boolean }
  | { kind: "error"; message: string };

type RouteResponse =
  | { ok: true; thumbnail_url: string; coverage_pct: number; fallback: boolean }
  | { ok: false; error: string; detail?: string };

export default function FitCenterButton({
  productId,
  currentThumbnailUrl,
}: Props) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [previewUrl, setPreviewUrl] = useState<string | null>(
    currentThumbnailUrl ?? null,
  );

  useEffect(() => {
    if (state.kind !== "ok") setPreviewUrl(currentThumbnailUrl ?? null);
  }, [currentThumbnailUrl, state.kind]);

  const disabled = !productId || state.kind === "running";

  async function onClick() {
    if (!productId) return;
    setState({ kind: "running" });
    let res: Response;
    try {
      res = await fetch("/api/admin/fit-center", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: productId }),
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
      setState({ kind: "error", message: `non-json response (HTTP ${res.status})` });
      return;
    }
    if (!json.ok) {
      const detail = "detail" in json ? json.detail : undefined;
      setState({ kind: "error", message: detail ? `${json.error}: ${detail}` : json.error });
      return;
    }
    setState({
      kind: "ok",
      thumbnailUrl: json.thumbnail_url,
      coverage: json.coverage_pct,
      fallback: json.fallback,
    });
    setPreviewUrl(json.thumbnail_url);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="aspect-[3/4] w-[150px] flex-shrink-0 overflow-hidden rounded-md border border-neutral-200 bg-neutral-50">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt="Card thumbnail preview"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center px-3 text-center text-[11px] text-neutral-400">
              No thumbnail yet.
            </div>
          )}
        </div>
        <div className="pt-1 text-xs text-neutral-500">
          ← 卡片 3:4 框里的样子
          {state.kind === "ok" && (
            <div className="mt-1 text-emerald-700">
              已居中 ✓ 产品约占框 {state.coverage}%
              {state.fallback && "（未检测到主体，居中裁切）"}
            </div>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="self-start rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 transition hover:border-neutral-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {state.kind === "running" ? (
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-700"
            />
            正在居中…
          </span>
        ) : state.kind === "error" ? (
          "重试居中"
        ) : (
          "框内居中（保留背景）"
        )}
      </button>

      {!productId && (
        <span className="text-[11px] text-neutral-500">Save the product first.</span>
      )}
      {state.kind === "error" && (
        <div className="rounded-md bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
          {state.message}
        </div>
      )}
    </div>
  );
}
