"use client";

/**
 * Wave 6 · Commit 2 — 1-click Publish on the admin list.
 *
 * The previous design (Wave 2B · Commit 9) deliberately moved status
 * flips to the edit page so the 3-gate Publish requirement (rooms +
 * approved cutouts + GLB) could surface proper guidance. Wave 6 adds
 * back a one-click shortcut for drafts that the operator already
 * filled out — the gates still run server-side via
 * `setProductStatusAction`; on failure the action redirects to /admin
 * with `?err=publish_blocked&reason=…`, which the existing toast at
 * the top of the page already renders ("…blocked … no rooms picked"
 * etc.). So the UX on a half-finished draft is "click Publish, see the
 * red toast naming the missing gate, click Edit to fix it" — same
 * affordance, one fewer hop on the happy path.
 *
 * Why no nested <form>: /admin's table is wrapped in
 * <form id="bulk-form"> for bulk ops; nesting forms is invalid HTML.
 * We call the server action directly via useTransition.
 */

import { useTransition } from "react";
import { setProductStatusAction } from "@/app/admin/(dashboard)/products/actions";

type Props = {
  productId: string;
};

export default function PublishButton({ productId }: Props) {
  const [pending, startTransition] = useTransition();

  function publish() {
    const fd = new FormData();
    fd.set("id", productId);
    fd.set("status", "published");
    startTransition(async () => {
      await setProductStatusAction(fd);
    });
  }

  return (
    <button
      type="button"
      onClick={publish}
      disabled={pending}
      className={`rounded-md px-2 py-1 text-xs font-medium text-white transition ${
        pending
          ? "bg-emerald-400 opacity-60"
          : "bg-emerald-600 hover:bg-emerald-700"
      }`}
      title="Publish this draft. Requires rooms + approved cutouts + GLB; failures show in a toast."
    >
      {pending ? "Publishing…" : "Publish"}
    </button>
  );
}
