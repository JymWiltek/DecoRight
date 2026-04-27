"use client";

/**
 * AI autofill button (Phase 3).
 *
 * On click, two paths:
 *
 *   A. Staged photos exist in the dropzone (`peekFiles("raw_images")`
 *      returns ≥ 1 File). We downscale + JPEG-encode each to a base64
 *      data URL client-side, then call `runAiInferStaged(dataUrls)`.
 *      This is the path that fixes the "AI fails because Storage is
 *      empty until Save" bug — Phase 1's commit-on-Save flow means
 *      bytes only live in the browser until the operator clicks Save,
 *      so the AI button has to read from there too.
 *
 *   B. No staged photos but a productId is set. Falls back to
 *      `runAiInfer(productId)` which signs Storage URLs for the
 *      already-saved `product_images` rows. This is the "re-run on
 *      an existing product without re-uploading" case.
 *
 * Either path returns the same shape; the button:
 *   1. Publishes the picks via `emitAutofillApply` → each picker
 *      (PillGrid / RoomsPicker / SubtypePicker) listens and updates
 *      its internal selected-state. Hidden inputs follow automatically
 *      so the normal Save flow persists the AI picks.
 *   2. Renders a per-field confidence badge row:
 *        ≥ 0.7 → green ("high")
 *        0.3-0.7 → amber ("medium, verify")
 *        < 0.3 → red ("low, human review")
 *
 * No DB writes from this component — Save still flows through
 * updateProduct. After a run we emit hidden <input name="ai_filled_fields">
 * rows for every key the model filled; ProductForm separately emits
 * the persisted list for already-AI-touched rows. parsePayload on
 * the server de-dupes the union into a Set before writing, so the
 * two sources can safely overlap.
 *
 * Rate limit: soft 100 runs/day via localStorage. Nothing server-
 * side yet — a determined user could wipe localStorage. Hard limit
 * lives in a later phase (per-admin DB quota). For now this is a
 * "don't accidentally burn $50" guardrail.
 */

import { useEffect, useState, useTransition } from "react";
import {
  runAiInfer,
  runAiInferStaged,
  type RunAiInferResult,
} from "@/app/admin/(dashboard)/products/actions";
import {
  emitAutofillApply,
  type AutofillFieldName,
} from "@/lib/ai/autofill-bus";
import { useStagedUploads } from "./product-form-staging";

type Props = {
  /** Product id, used only by the Storage-fallback path
   *  (`runAiInfer`). Null on /products/new — the staged-photos path
   *  doesn't need it, so the button is fully usable on a fresh
   *  product as long as a photo has been dropped. */
  productId: string | null;
  /** id of the main <form> so the hidden `ai_filled_fields` inputs
   *  we render after a run submit with the rest of ProductForm
   *  (which uses the "empty form + external inputs" layout). */
  form: string;
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

export default function AIInferButton({ productId, form }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<LastRun | null>(null);
  const [todayCount, setTodayCount] = useState<number>(0);
  const { peekFiles } = useStagedUploads();

  // Rehydrate today's counter on mount so the button immediately
  // shows "N / 100 today" instead of 0 → N after first click.
  useEffect(() => {
    setTodayCount(getTodayCount().count);
  }, []);

  // The button is enabled whenever there's *anywhere* to read images
  // from — either fresh staged photos in the dropzone, or saved
  // images attached to a productId. We don't try to be smart about
  // peekFiles().length here because that runs in render and would
  // need a re-render on every dropzone state change (and the bottom
  // hint already covers the empty case via the click handler).
  const disabled = pending || todayCount >= RATE_LIMIT_MAX;

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
      // Staged photos (if any) win over Storage. They reflect the
      // operator's *current* intent: even on an existing product,
      // dragging a fresh batch onto the dropzone implies "classify
      // these, not the old ones". Storage is only consulted as the
      // fallback path when nothing is staged but a productId exists.
      const stagedFiles = peekFiles("raw_images");

      let res: RunAiInferResult;

      if (stagedFiles.length > 0) {
        try {
          const dataUrls = await encodeStagedPhotos(stagedFiles);
          res = await runAiInferStaged(dataUrls);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setError(`Failed to encode staged photos: ${msg}`);
          return;
        }
      } else if (productId) {
        res = await runAiInfer(productId);
      } else {
        setError(
          "Drop a photo into the Photos section first, then click AI autofill.",
        );
        return;
      }

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
      {/* Hidden inputs so Save persists the AI-touched key set into
          products.ai_filled_fields. Rendered OUTSIDE the <form> and
          linked via form={…} like every other field on this page. */}
      {lastRun?.inferredKeys.map((key) => (
        <input
          key={`ai-${key}`}
          form={form}
          type="hidden"
          name="ai_filled_fields"
          value={key}
        />
      ))}
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
        <span className="text-xs text-neutral-400">
          {todayCount} / {RATE_LIMIT_MAX} runs today · GPT-4o Vision
        </span>
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

/**
 * Downscale + JPEG-encode a batch of staged photos into base64 data
 * URLs that fit Vercel's 10 MB Server Action body cap and the OpenAI
 * Vision sweet spot.
 *
 * Why downscale instead of sending the originals: phone shots are
 * routinely 8 MB / 4032×3024. Three of them base64-encoded would be
 * ~33 MB — over the action body limit AND wasted on Vision, which
 * downscales internally to ≤768×2048 anyway. Re-encoding to ≤2048 px
 * longest side at q=0.85 lands each image at 200-500 KB.
 *
 * Cap input batch at MAX_AI_IMAGES so a 20-photo dropzone doesn't
 * try to encode them all only for the server to drop the tail.
 *
 * Errors here surface as a user-facing banner — no silent fallback,
 * because a corrupted/unsupported file would otherwise produce
 * confusing OpenAI 4xx errors a few seconds later.
 */
const MAX_AI_IMAGES = 3;
const MAX_DIMENSION = 2048;
const JPEG_QUALITY = 0.85;

async function encodeStagedPhotos(files: File[]): Promise<string[]> {
  const subset = files.slice(0, MAX_AI_IMAGES);
  const encoded: string[] = [];
  for (const file of subset) {
    encoded.push(await encodeOne(file));
  }
  return encoded;
}

async function encodeOne(file: File): Promise<string> {
  // createImageBitmap handles JPEG/PNG/WebP and respects EXIF
  // orientation when imageOrientation: "from-image" is set —
  // important so portrait phone shots arrive upright instead of
  // sideways (which Vision still classifies, but worse).
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  try {
    const { width, height } = scaleToFit(
      bitmap.width,
      bitmap.height,
      MAX_DIMENSION,
    );
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2D context unavailable");
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob(
        (b) =>
          b ? resolve(b) : reject(new Error("canvas.toBlob returned null")),
        "image/jpeg",
        JPEG_QUALITY,
      ),
    );
    return await blobToDataUrl(blob);
  } finally {
    bitmap.close();
  }
}

function scaleToFit(
  w: number,
  h: number,
  max: number,
): { width: number; height: number } {
  if (w <= max && h <= max) return { width: w, height: h };
  const ratio = w >= h ? max / w : max / h;
  return { width: Math.round(w * ratio), height: Math.round(h * ratio) };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result;
      if (typeof r !== "string") {
        reject(new Error("FileReader returned non-string result"));
        return;
      }
      resolve(r);
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader error"));
    reader.readAsDataURL(blob);
  });
}
