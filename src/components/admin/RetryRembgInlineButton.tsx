"use client";

/**
 * Tiny "Retry rembg" button for the /admin products list. Shown only
 * when a product has images stuck in `raw` or `cutout_failed` —
 * typically because the browser closed mid-kickRembg during a direct
 * upload, or the rembg provider threw.
 *
 * One click re-runs rembg in AUTO mode for every stuck id on that
 * product. We do them sequentially (same reason as kickRembgPipeline
 * — the advisory-lock-protected quota meter prefers serial calls)
 * and show a per-id count while we go. On completion we
 * router.refresh() so the list re-pulls the (hopefully smaller)
 * stuck set.
 *
 * No redirect loop, no <form> required — the whole thing is a
 * direct server-action call from client code.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { retryRembgOne } from "@/app/admin/(dashboard)/products/upload-actions";

type Props = {
  productId: string;
  imageIds: string[];
};

export default function RetryRembgInlineButton({ productId, imageIds }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [lastMsg, setLastMsg] = useState<string | null>(null);

  if (imageIds.length === 0) return null;

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    setLastMsg(null);
    setProgress({ done: 0, total: imageIds.length });

    let ok = 0;
    let fail = 0;
    let lastErr: string | null = null;
    for (let i = 0; i < imageIds.length; i++) {
      const res = await retryRembgOne(productId, imageIds[i]);
      if (res.ok) ok++;
      else {
        fail++;
        lastErr = `${res.code}: ${res.msg}`;
      }
      setProgress({ done: i + 1, total: imageIds.length });
    }

    setBusy(false);
    setProgress(null);
    setLastMsg(
      fail === 0
        ? `${ok}/${imageIds.length} approved.`
        : `${ok} ok · ${fail} failed${lastErr ? ` (${lastErr})` : ""}`,
    );
    router.refresh();
  }

  return (
    <div className="flex flex-col items-start gap-0.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800 hover:bg-amber-200 disabled:opacity-60"
        title={
          busy
            ? "Retrying…"
            : `Re-run background removal on ${imageIds.length} stuck image${imageIds.length === 1 ? "" : "s"}`
        }
      >
        {busy
          ? `Retrying ${progress?.done ?? 0}/${progress?.total ?? imageIds.length}…`
          : `↻ Retry rembg (${imageIds.length})`}
      </button>
      {lastMsg && !busy && (
        <span className="text-[10px] text-neutral-500">{lastMsg}</span>
      )}
    </div>
  );
}
