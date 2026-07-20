"use client";

/**
 * Defect flag — the operator's "I looked at this and it's wrong" verdict,
 * raised straight from the product list.
 *
 * Not a status: a product can be a published defect (spotted after it went
 * live) or a draft defect. The flag doesn't move the row anywhere, it just
 * blocks publishing — enforcement lives in checkPublishGates as a sixth gate,
 * so the "Ready to publish" filter and bulk-publish both honour it without
 * knowing anything about defects.
 *
 * Always-visible icon (never hover-only) with a 36px tap target, so it works
 * on the phone the same as on a desktop. Flagged rows render the flag solid
 * red; the row itself also gets a red tint from the page.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setProductDefectAction } from "@/app/admin/(dashboard)/products/inline-edit-actions";

/** Preset reasons — the three failure modes that actually recur. "Other"
 *  falls back to free text; the column itself is unconstrained. */
const PRESETS = ["场景图错误", "3D 模型错误", "数据错误"] as const;

export default function DefectFlag({
  productId,
  productName,
  defect,
  reason,
}: {
  productId: string;
  productName: string;
  defect: boolean;
  reason: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState(reason ?? "");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => setDraft(reason ?? ""), [reason]);
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function commit(next: boolean, nextReason: string) {
    setError(null);
    startTransition(async () => {
      const res = await setProductDefectAction(productId, next, nextReason);
      if (res.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setError(null);
          setDraft(reason ?? "");
          setOpen((o) => !o);
        }}
        title={defect ? `Defect: ${reason ?? ""}` : "Flag as defective"}
        aria-label={defect ? `Defect flagged on ${productName}` : `Flag ${productName} as defective`}
        aria-pressed={defect}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition ${
          defect
            ? "text-rose-600 hover:bg-rose-50"
            : "text-neutral-300 hover:bg-neutral-100 hover:text-neutral-600"
        } ${pending ? "opacity-50" : ""}`}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill={defect ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
          <line x1="4" y1="22" x2="4" y2="15" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-60 rounded-md border border-neutral-200 bg-white p-3 shadow-lg">
          <div className="mb-2 text-[11px] font-medium text-neutral-700">
            {defect ? "已标记为 defect" : "标记为 defect"}
          </div>
          <div className="mb-2 flex flex-wrap gap-1">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setDraft(p)}
                className={`rounded-full px-2 py-0.5 text-[11px] transition ${
                  draft === p
                    ? "bg-rose-600 text-white"
                    : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="原因(可自由填写)"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit(true, draft);
              }
            }}
            className="mb-2 w-full rounded border border-neutral-300 px-2 py-1 text-xs outline-none focus:border-rose-400"
          />
          {error && (
            <div className="mb-2 text-[11px] text-rose-700">{error}</div>
          )}
          <div className="flex justify-between gap-2">
            {defect ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => commit(false, "")}
                className="rounded border border-neutral-300 px-2 py-1 text-[11px] text-neutral-700 hover:border-neutral-500 disabled:opacity-50"
              >
                取消标记
              </button>
            ) : (
              <span />
            )}
            <button
              type="button"
              disabled={pending}
              onClick={() => commit(true, draft)}
              className="rounded bg-rose-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-rose-700 disabled:opacity-50"
            >
              {defect ? "更新原因" : "标记 defect"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
