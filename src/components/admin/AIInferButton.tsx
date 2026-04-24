"use client";

/**
 * AI autofill button (Phase 3).
 *
 * On click:
 *   1. Calls the `runAiInfer(productId)` server action, which fetches
 *      up to 3 product images, asks GPT-4o Vision to classify against
 *      the live taxonomy, and returns slug picks + confidence.
 *   2. Publishes the picks via `emitAutofillApply` → each picker
 *      (PillGrid / RoomsPicker / SubtypePicker) listens and updates
 *      its internal selected-state. Hidden inputs follow automatically
 *      so the normal Save flow persists the AI picks.
 *   3. Renders a per-field confidence badge row:
 *        ≥ 0.7 → green ("high")
 *        0.3-0.7 → amber ("medium, verify")
 *        < 0.3 → red ("low, human review")
 *
 * No DB writes from this component — Save still flows through
 * updateProduct. The AI-filled fields get stamped into
 * products.ai_filled_fields by the hidden input already emitted
 * by ProductForm whenever the bound product row carries that array.
 *
 * Rate limit: soft 100 runs/day via localStorage. Nothing server-
 * side yet — a determined user could wipe localStorage. Hard limit
 * lives in a later phase (per-admin DB quota). For now this is a
 * "don't accidentally burn $50" guardrail.
 */

import { useEffect, useState, useTransition } from "react";
import { runAiInfer, type RunAiInferResult } from "@/app/admin/(dashboard)/products/actions";
import {
  emitAutofillApply,
  type AutofillFieldName,
} from "@/lib/ai/autofill-bus";

type Props = {
  /** Product id the AI should classify. Null on /products/new
   *  (before the first Save redirect) — button renders a hint
   *  instead of firing. */
  productId: string | null;
};

type LastRun = Extract<RunAiInferResult, { ok: true }>;

const RATE_LIMIT_KEY = "dr-ai-autofill-day";
const RATE_LIMIT_MAX = 100;

/** Load today's counter from localStorage; resets at local midnight
 *  by using YYYY-MM-DD as the stored day key. Kept on the client
 *  to keep the action payload small and avoid an extra round trip
 *  just to read a counter. */
function getTodayCount(): { day: string; count: number } {
  if (typeof window === "undefined") return { day: "", count: 0 };
  const today = new Date().toISOString().slice(0, 10);
  try {
    const raw = window.localStorage.getItem(RATE_LIMIT_KEY);
    if (!raw) return { day: today, count: 0 };
    const parsed = JSON.parse(raw) as { day: string; count: number };
    if (parsed.day !== today) return { day: today, count: 0 };
    return parsed;
  } catch {
    return { day: today, count: 0 };
  }
}

function bumpTodayCount(): number {
  if (typeof window === "undefined") return 0;
  const cur = getTodayCount();
  const next = { day: cur.day, count: cur.count + 1 };
  window.localStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(next));
  return next.count;
}

export default function AIInferButton({ productId }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<LastRun | null>(null);
  const [todayCount, setTodayCount] = useState<number>(0);

  // Rehydrate today's counter on mount so the button immediately
  // shows "N / 100 today" instead of 0 → N after first click.
  useEffect(() => {
    setTodayCount(getTodayCount().count);
  }, []);

  const disabled = pending || !productId || todayCount >= RATE_LIMIT_MAX;

  function onClick() {
    setError(null);
    const cur = getTodayCount();
    if (cur.count >= RATE_LIMIT_MAX) {
      setError(
        `Daily AI autofill quota reached (${RATE_LIMIT_MAX}). Try again tomorrow.`,
      );
      return;
    }
    startTransition(async () => {
      const res = await runAiInfer(productId);
      const count = bumpTodayCount();
      setTodayCount(count);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setLastRun(res);
      emitAutofillApply({
        item_type: (res.fields.item_type as string | undefined) ?? null,
        subtype_slug: (res.fields.subtype_slug as string | undefined) ?? null,
        room_slugs: (res.fields.room_slugs as string[] | undefined) ?? [],
        styles: (res.fields.styles as string[] | undefined) ?? [],
        colors: (res.fields.colors as string[] | undefined) ?? [],
        materials: (res.fields.materials as string[] | undefined) ?? [],
        confidence: res.confidence as Partial<Record<AutofillFieldName, number>>,
      });
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          className="self-start rounded-md border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 transition hover:border-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending
            ? "AI analyzing image…"
            : lastRun
              ? "Re-run AI autofill"
              : "AI autofill"}
        </button>
        {!productId && (
          <span className="text-xs text-neutral-500">
            Save the product and upload a photo first.
          </span>
        )}
        {productId && (
          <span className="text-xs text-neutral-400">
            {todayCount} / {RATE_LIMIT_MAX} runs today · GPT-4o Vision
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </div>
      )}

      {lastRun && (
        <div className="flex flex-col gap-2 rounded-md border border-sky-200 bg-sky-50/50 px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-neutral-600">
            <span>
              <span className="font-semibold">Model:</span> {lastRun.model}
            </span>
            <span>
              <span className="font-semibold">Latency:</span>{" "}
              {(lastRun.debug.latency_ms / 1000).toFixed(1)}s
            </span>
            <span>
              <span className="font-semibold">Images:</span>{" "}
              {lastRun.debug.imageCount}
            </span>
            {lastRun.debug.usage?.total_tokens != null && (
              <span>
                <span className="font-semibold">Tokens:</span>{" "}
                {lastRun.debug.usage.total_tokens}
              </span>
            )}
          </div>

          {lastRun.inferredKeys.length === 0 ? (
            <div className="text-neutral-600">
              {lastRun.note ?? "AI made no confident picks for this image."}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {lastRun.inferredKeys.map((key) => (
                <ConfidenceChip
                  key={key}
                  field={key}
                  score={lastRun.confidence[key] ?? 0}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Color-coded pill showing a field's confidence score. Green ≥ 0.7,
 *  amber 0.3-0.7, red < 0.3 — matches the thresholds the prompt
 *  instructs the model to use. */
function ConfidenceChip({ field, score }: { field: string; score: number }) {
  const pct = Math.round(score * 100);
  const tone =
    score >= 0.7
      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
      : score >= 0.3
        ? "border-amber-300 bg-amber-50 text-amber-800"
        : "border-rose-300 bg-rose-50 text-rose-800";
  const label = prettyFieldName(field);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${tone}`}
      title={
        score >= 0.7
          ? "High confidence — likely correct"
          : score >= 0.3
            ? "Medium confidence — please verify"
            : "Low confidence — human review recommended"
      }
    >
      <span>✨ {label}</span>
      <span className="tabular-nums opacity-70">{pct}%</span>
    </span>
  );
}

function prettyFieldName(key: string): string {
  switch (key) {
    case "item_type":
      return "item type";
    case "subtype_slug":
      return "subtype";
    case "room_slugs":
      return "rooms";
    default:
      return key;
  }
}
