"use client";

/**
 * BUG-3+2 — the SINGLE "Auto-fill with AI" button for the product edit
 * page. Replaces the two older buttons (the classify-only one whose
 * confidence GPT pinned at a flat 90%, and the V1 spec-sheet block).
 *
 * One click runs the V2 spec parser server-side (runSpecParseV2), which
 * reads the product's Feed-to-AI images and returns EVERY field in one
 * pass — name / brand / SKU / description / dimensions / weight / price /
 * item_type / subtype / rooms / styles / colors / materials — each with a
 * REAL per-field confidence (high / medium / low), not a hardcoded number.
 *
 * Apply:
 *   • taxonomy + name + description → emitAutofillApply (the pickers +
 *     AutofillTextInput listen and update themselves).
 *   • scalars (brand / sku / dims / weight / price) → written straight
 *     into their form inputs by name.
 *   • a hidden ai_filled_fields input per filled key so Save records
 *     which fields the AI touched.
 *
 * No DB write here — Save still flows through updateProduct. Requires the
 * images to already be uploaded (they are: the edit dropzone now uploads
 * on drop, BUG-1).
 */

import { useState, useTransition } from "react";
import {
  runSpecParseV2,
  type RunSpecV2Result,
} from "@/app/admin/(dashboard)/products/actions";
import { emitAutofillApply } from "@/lib/ai/autofill-bus";

type Props = {
  productId: string | null;
  /** id of the main <form> so the hidden ai_filled_fields inputs submit. */
  form: string;
};

type Ok = Extract<RunSpecV2Result, { ok: true }>;
type Confidence = "high" | "medium" | "low";

/** Honest band → representative number for the bus' confidence map. The
 *  CHIPS show the WORD (below), not this number — but the pickers' own
 *  confidence hints expect a 0-1 value. */
const BAND_TO_NUM: Record<Confidence, number> = { high: 0.9, medium: 0.6, low: 0.3 };

export default function AiAutofillButton({ productId, form }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<Ok | null>(null);

  function setInput(name: string, value: string) {
    const el = document.querySelector<HTMLInputElement>(
      `input[name="${name}"][form="${form}"]`,
    );
    if (el) {
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function onClick() {
    setError(null);
    if (!productId) {
      setError("Save the product first (or drop a photo — it uploads right away).");
      return;
    }
    startTransition(async () => {
      const res = await runSpecParseV2(productId);
      if (!res.ok) {
        setError(res.error);
        setRun(null);
        return;
      }
      setRun(res);
      const f = res.fields;
      const c = res.confidence;
      // Map only the applied taxonomy/text bands into the bus.
      const conf: Record<string, number> = {};
      for (const [k, band] of Object.entries(c)) conf[k] = BAND_TO_NUM[band];
      emitAutofillApply({
        name: f.name ?? undefined,
        description: f.description ?? undefined,
        item_type: f.item_type,
        subtype_slug: f.subtype_slug,
        room_slugs: f.room_slugs,
        styles: f.styles,
        colors: f.colors,
        materials: f.materials,
        confidence: conf,
      });
      // Scalars → form inputs.
      if (f.brand) setInput("brand", f.brand);
      if (f.sku_id) setInput("sku_id", f.sku_id);
      if (f.dim_length != null) setInput("dim_length", String(f.dim_length));
      if (f.dim_width != null) setInput("dim_width", String(f.dim_width));
      if (f.dim_height != null) setInput("dim_height", String(f.dim_height));
      if (f.weight_kg != null) setInput("weight_kg", String(f.weight_kg));
      if (f.price_myr != null) setInput("price_myr", String(f.price_myr));
      if (f.price_original_myr != null)
        setInput("price_original_myr", String(f.price_original_myr));
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Persist which fields the AI filled (products.ai_filled_fields). */}
      {run?.inferredKeys.map((key) => (
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
          disabled={pending}
          className="self-start rounded-md border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 transition hover:border-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending
            ? "Reading images…"
            : run
              ? "Re-run AI auto-fill"
              : "Auto-fill with AI"}
        </button>
        <span className="text-xs text-neutral-400">
          Reads every “Feed to AI” image · GPT-4o · fills price / SKU /
          dimensions / description / category
        </span>
      </div>

      {error && (
        <div className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </div>
      )}

      {run && (
        <div className="flex flex-col gap-2 rounded-md border border-sky-200 bg-sky-50/50 px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-neutral-600">
            <span>
              <span className="font-semibold">Images read:</span>{" "}
              {run.debug.imageCount}
            </span>
            <span>
              <span className="font-semibold">Latency:</span>{" "}
              {(run.debug.latencyMs / 1000).toFixed(1)}s
            </span>
            {run.debug.tokens != null && (
              <span>
                <span className="font-semibold">Tokens:</span> {run.debug.tokens}
              </span>
            )}
          </div>
          {run.inferredKeys.length === 0 ? (
            <div className="text-neutral-600">
              {run.note || "AI couldn’t read any fields from these images."}
            </div>
          ) : (
            <>
              <div className="text-[11px] text-neutral-500">
                Per-field confidence (the model’s real certainty — not a
                fixed score). Verify amber/red before publishing.
              </div>
              <div className="flex flex-wrap gap-1.5">
                {run.inferredKeys.map((key) => (
                  <ConfChip key={key} field={key} band={run.confidence[key]} />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ConfChip({ field, band }: { field: string; band: Confidence }) {
  const tone =
    band === "high"
      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
      : band === "medium"
        ? "border-amber-300 bg-amber-50 text-amber-800"
        : "border-rose-300 bg-rose-50 text-rose-800";
  const word = band === "high" ? "High" : band === "medium" ? "Med" : "Low";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${tone}`}
      title={`${field}: ${band} confidence`}
    >
      <span>✨ {pretty(field)}</span>
      <span className="font-semibold uppercase opacity-80">{word}</span>
    </span>
  );
}

function pretty(key: string): string {
  switch (key) {
    case "item_type":
      return "category";
    case "subtype_slug":
      return "subtype";
    case "room_slugs":
      return "rooms";
    case "sku_id":
      return "SKU";
    case "dimensions_mm":
      return "dimensions";
    case "price_myr":
      return "price";
    case "price_original_myr":
      return "orig. price";
    case "weight_kg":
      return "weight";
    default:
      return key;
  }
}
