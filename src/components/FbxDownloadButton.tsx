"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { startFbxDownload } from "@/app/designer/download-actions";

/**
 * Sprint 1 C2 — gated FBX download button.
 *   • Not a logged-in designer → links to /designer/login?next=… .
 *   • Logged-in designer → calls startFbxDownload (deducts
 *     download_credit_cost + records the download), then navigates to
 *     the returned URL. Insufficient credit → recharge hint.
 * GLB / AR stay free; only FBX is gated.
 */
export default function FbxDownloadButton({
  productId,
  creditCost,
  fbxSizeKb,
  designerLoggedIn,
  loginHref,
}: {
  productId: string;
  creditCost: number;
  fbxSizeKb: number | null;
  designerLoggedIn: boolean;
  loginHref: string;
}) {
  const t = useTranslations("product");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const creditBadge = (
    <span className="ml-2 rounded-full bg-neutral-900/90 px-2 py-0.5 text-xs font-medium text-white">
      {creditCost} credit
    </span>
  );
  const sizeNote = fbxSizeKb != null && (
    <span className="ml-2 text-xs text-neutral-500">
      ({(fbxSizeKb / 1024).toFixed(1)} MB)
    </span>
  );
  const cls =
    "inline-flex items-center justify-center rounded-md bg-neutral-100 px-5 py-3 text-sm font-medium text-neutral-800 transition hover:bg-neutral-200 disabled:cursor-wait disabled:opacity-60";

  if (!designerLoggedIn) {
    return (
      <a href={loginHref} className={cls}>
        {t("downloadFbx")}
        {creditBadge}
        <span className="ml-2 text-xs text-neutral-500">· {t("signInToDownload")}</span>
      </a>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        className={cls}
        onClick={() =>
          start(async () => {
            setMsg(null);
            const r = await startFbxDownload(productId);
            if (r.ok) {
              window.location.href = r.url;
            } else if (r.code === "unauthorized") {
              window.location.href = loginHref;
            } else if (r.code === "insufficient") {
              setMsg(t("insufficientCredit"));
            } else {
              setMsg(t("downloadFailed"));
            }
          })
        }
      >
        {t("downloadFbx")}
        {creditBadge}
        {sizeNote}
      </button>
      {msg && (
        <p className="rounded bg-rose-50 px-2 py-1 text-xs text-rose-700">{msg}</p>
      )}
    </div>
  );
}
