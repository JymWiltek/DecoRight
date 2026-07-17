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

  // PB3-B item 2 — low-emphasis one-line link (small icon + small muted
  // text), NOT a button-weight block. Content is preserved (FBX label,
  // credit cost, sign-in requirement, size) — it's just visually de-ranked
  // below the primary CTA. Not hidden: a paying visitor can still find it.
  const icon = (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0"
    >
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
  const creditNote = (
    <span className="text-neutral-400">· {creditCost} credit</span>
  );
  const sizeNote = fbxSizeKb != null && (
    <span className="text-neutral-400">
      · {(fbxSizeKb / 1024).toFixed(1)} MB
    </span>
  );
  const cls =
    "inline-flex items-center gap-1.5 text-xs text-neutral-500 underline-offset-2 transition hover:text-neutral-700 hover:underline disabled:cursor-wait disabled:opacity-60";

  if (!designerLoggedIn) {
    return (
      <a href={loginHref} className={cls}>
        {icon}
        <span>{t("downloadFbx")}</span>
        {creditNote}
        <span className="text-neutral-400">· {t("signInToDownload")}</span>
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
        {icon}
        <span>{t("downloadFbx")}</span>
        {creditNote}
        {sizeNote}
      </button>
      {msg && (
        <p className="rounded bg-rose-50 px-2 py-1 text-xs text-rose-700">{msg}</p>
      )}
    </div>
  );
}
