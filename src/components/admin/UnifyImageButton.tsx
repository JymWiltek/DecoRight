"use client";

/**
 * Wave 11b — per-image "Unify Center" button on the product workbench.
 *
 * Uploads now default to raw-as-is (skip_cutout); the operator picks
 * which image becomes the storefront card and whether to run the
 * white-canvas unify treatment on it. Clicking this:
 *   1. Calls makeImagePrimaryThumbnail() so this image is the product's
 *      is_primary_thumbnail (the unify route reads that flag).
 *   2. POSTs /api/admin/unify-thumbnail — the SAME route the
 *      product-level "Re-unify thumbnail" button uses, so there is one
 *      source of truth for products.thumbnail_url. Browser session
 *      cookie authenticates the call (route's requireAdmin gate).
 *   3. router.refresh() so the card grid + thumbnail preview re-render.
 *
 * Mirrors ReunifyThumbnailButton's fetch shape; kept lean (no preview
 * box) because it lives inline on each image card.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { makeImagePrimaryThumbnail } from "@/app/admin/(dashboard)/products/[id]/edit/image-actions";

type Props = {
  imageId: string;
  productId: string;
};

type State =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ok" }
  | { kind: "error"; message: string };

type RouteResponse =
  | { ok: true; thumbnail_url: string }
  | { ok: false; error: string; detail?: string };

export default function UnifyImageButton({ imageId, productId }: Props) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "idle" });

  async function onClick() {
    setState({ kind: "running" });
    // 1. Make this image the primary thumbnail so the route unifies it.
    const primary = await makeImagePrimaryThumbnail(imageId, productId);
    if (!primary.ok) {
      setState({ kind: "error", message: primary.error });
      return;
    }
    // 2. Run the unify route (browser cookie auth).
    let res: Response;
    try {
      res = await fetch("/api/admin/unify-thumbnail", {
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
      setState({ kind: "error", message: `non-json (HTTP ${res.status})` });
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
    setState({ kind: "ok" });
    router.refresh();
    setTimeout(() => setState((s) => (s.kind === "ok" ? { kind: "idle" } : s)), 3000);
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={onClick}
        disabled={state.kind === "running"}
        title="Center this image on a white card canvas and make it the storefront thumbnail."
        className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-[11px] font-medium hover:border-black disabled:cursor-not-allowed disabled:opacity-50"
      >
        {state.kind === "running"
          ? "正在 unify…"
          : state.kind === "ok"
            ? "✓ Unified"
            : state.kind === "error"
              ? "Retry unify"
              : "Unify Center"}
      </button>
      {state.kind === "error" && (
        <p className="rounded bg-rose-50 px-2 py-1 text-[10px] leading-snug text-rose-700">
          {state.message}
        </p>
      )}
    </div>
  );
}
