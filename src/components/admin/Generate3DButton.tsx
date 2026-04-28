"use client";

/**
 * Wave 2A · Commit 6 — Standalone "Generate 3D" button.
 *
 * Publish-flow γ redesign moves Meshy out from "auto-trigger inside
 * the held-back-status Publish path" to "explicit operator action".
 *
 * Renders inside MeshyStatusBanner's "ready" branch — i.e. when:
 *   - meshy_status is null (never run)
 *   - glb_url is null (no manual upload)
 *   - cutout_approved count >= 1 (Meshy needs at least 1 image;
 *     up to 4 — kickOffMeshyForProduct hard-caps)
 *
 * On click, fires `generate3DForProduct`. The kickoff helper does
 * the heavy lifting (image set selection, Meshy POST, api_usage
 * billing, products row update). On success, MeshyStatusBanner's
 * existing 5s polling loop picks up the new 'generating' state on
 * the next tick and flips the banner to the blue progress branch.
 * No router.refresh needed here — the banner is already polling
 * itself once it sees status='generating'.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generate3DForProduct } from "@/app/admin/(dashboard)/products/actions";

type Props = {
  productId: string;
};

export default function Generate3DButton({ productId }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    startTransition(async () => {
      const res = await generate3DForProduct(productId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Refresh so MeshyStatusBanner re-reads the row and the
      // banner flips from "ready" to "generating" without waiting
      // for its own 5s tick. The banner takes over polling from
      // there.
      router.refresh();
    });
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="self-start rounded-md border border-violet-400 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-800 transition hover:border-violet-700 disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? "Starting Meshy…" : "Generate 3D model"}
      </button>
      {error && (
        <div className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </div>
      )}
    </div>
  );
}
