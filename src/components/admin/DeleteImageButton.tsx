"use client";

import { useTransition } from "react";
import { deleteProductImage } from "@/app/admin/(dashboard)/products/[id]/upload/actions";

/**
 * Delete button for a single product image. Confirms client-side
 * before firing the server action. If the image is the synced
 * primary, the catalog's thumbnail will be nulled too — the prompt
 * warns about that so the operator doesn't delete the one image the
 * public storefront is showing without meaning to.
 */
export default function DeleteImageButton({
  imageId,
  returnTo,
  isPrimary,
}: {
  imageId: string;
  returnTo: string;
  isPrimary: boolean;
}) {
  const [pending, startTransition] = useTransition();

  const onClick = () => {
    const msg = isPrimary
      ? "Delete this image? It is the primary — the product will lose its catalog thumbnail until you approve another image as primary."
      : "Delete this image? This can't be undone.";
    if (!confirm(msg)) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("imageId", imageId);
      fd.set("returnTo", returnTo);
      await deleteProductImage(fd);
    });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="w-full rounded-md border border-neutral-200 px-3 py-1 text-[11px] text-neutral-500 hover:border-rose-300 hover:text-rose-600 disabled:opacity-50"
    >
      {pending ? "Deleting…" : "Delete"}
    </button>
  );
}
