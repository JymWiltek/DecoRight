"use client";

/**
 * Wave 5 (mig 0038) — admin "Auto-fill from image" block.
 *
 * Behavior change vs. Wave 3:
 *   • Was: operator uploads a fresh spec sheet, the action persists
 *     it as image_kind='spec_sheet' and forwards bytes to GPT-4o.
 *   • Now: operator picks one of the existing product images that
 *     have feed_to_ai=true. No new upload — the spec sheet (or any
 *     other image they want parsed) just goes through the regular
 *     image upload flow with feed_to_ai turned on.
 *
 * The flat image-pool model means we don't care what kind the image
 * is — a brand spec PDF screenshot, a product page snip, even a
 * cutout — they all go through GPT-4o vision the same way. The
 * `image_kind` column stays around for the cutout pipeline's
 * internal use, no longer gated by it here.
 *
 * UX flow:
 *   1. Operator sees a list of available images (thumbnails) for
 *      this product, filtered to feed_to_ai=true.
 *   2. Picks one (radio).
 *   3. Click "Parse" → server action fetches the bytes, calls GPT-4o,
 *      returns suggestions.
 *   4. Same per-field checkbox card + Apply button as before.
 *   5. Apply pushes name/description through the existing autofill
 *      bus + writes brand/sku/dim/weight directly into the form's
 *      uncontrolled inputs.
 */

import { useState, useTransition } from "react";
import {
  parseSpecSheetAction,
  type ParseSpecSheetResult,
} from "@/app/admin/(dashboard)/products/actions";
import { emitAutofillApply } from "@/lib/ai/autofill-bus";

type SuggestionRow = {
  /** Field key — also the FormData input name in ProductForm. */
  key:
    | "name"
    | "brand"
    | "sku_id"
    | "description"
    | "dim_length"
    | "dim_width"
    | "dim_height"
    | "weight_kg";
  label: string;
  /** AI-suggested value. null = AI returned null (nothing to apply). */
  value: string | null;
  /** Whether the operator wants to apply this on click. Initial:
   *  true when value is non-null, false otherwise. */
  checked: boolean;
};

/** Shape the ProductForm passes per image. */
export type AiCandidateImage = {
  id: string;
  /** Public preview URL — the cutout if available (it's already a
   *  public CDN URL); otherwise a signed URL of the raw upload that
   *  the page resolved server-side. May be null on rows that
   *  haven't finished processing. */
  previewUrl: string | null;
};

type Props = {
  /** Required — the action verifies the picked image belongs here. */
  productId: string | null;
  /** id attribute of the outer ProductForm <form>. We append hidden
   *  ai_filled_fields inputs there after Apply so the server action
   *  picks them up at Save time. */
  formId: string;
  /** All product_images rows with feed_to_ai=true, pre-resolved with
   *  preview URLs. Empty = no images yet; render an "upload an image
   *  first" hint instead of an empty picker. */
  candidates: AiCandidateImage[];
};

export default function SpecSheetAutofillBlock({
  productId,
  formId,
  candidates,
}: Props) {
  const [pickedId, setPickedId] = useState<string | null>(
    candidates[0]?.id ?? null,
  );
  const [pending, startTransition] = useTransition();
  const [suggestions, setSuggestions] = useState<SuggestionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [costUsd, setCostUsd] = useState<number | null>(null);
  const [notes, setNotes] = useState<string>("");
  const [appliedAt, setAppliedAt] = useState<number | null>(null);

  const disabled = !productId || pending || !pickedId;

  function onParse() {
    if (!productId || !pickedId) return;
    setError(null);
    setSuggestions(null);
    setCostUsd(null);
    setNotes("");
    setAppliedAt(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("imageId", pickedId);
      let res: ParseSpecSheetResult;
      try {
        res = await parseSpecSheetAction(productId, fd);
      } catch (e) {
        setError(
          `request failed: ${e instanceof Error ? e.message : String(e)}`,
        );
        return;
      }
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const r = res.result;
      const dim = r.dimensions_mm;
      const rows: SuggestionRow[] = [
        { key: "name", label: "Name", value: r.name, checked: r.name != null },
        { key: "brand", label: "Brand", value: r.brand, checked: r.brand != null },
        { key: "sku_id", label: "SKU", value: r.sku_id, checked: r.sku_id != null },
        {
          key: "description",
          label: "Description",
          value: r.description,
          checked: r.description != null,
        },
        {
          key: "dim_length",
          label: "Length (mm)",
          value: dim?.length != null ? String(dim.length) : null,
          checked: dim?.length != null,
        },
        {
          key: "dim_width",
          label: "Width (mm)",
          value: dim?.width != null ? String(dim.width) : null,
          checked: dim?.width != null,
        },
        {
          key: "dim_height",
          label: "Height (mm)",
          value: dim?.height != null ? String(dim.height) : null,
          checked: dim?.height != null,
        },
        {
          key: "weight_kg",
          label: "Weight (kg)",
          value: r.weight_kg != null ? String(r.weight_kg) : null,
          checked: r.weight_kg != null,
        },
      ];
      setSuggestions(rows);
      setCostUsd(res.estCostUsd);
      setNotes(r.notes ?? "");
    });
  }

  function toggleRow(key: SuggestionRow["key"]) {
    setSuggestions((prev) =>
      prev
        ? prev.map((r) => (r.key === key ? { ...r, checked: !r.checked } : r))
        : prev,
    );
  }

  function onApply() {
    if (!suggestions) return;
    const toApply = suggestions.filter((r) => r.checked && r.value != null);
    if (toApply.length === 0) return;

    const busDetail: { name?: string; description?: string } = {};
    for (const r of toApply) {
      if (r.key === "name") busDetail.name = r.value!;
      if (r.key === "description") busDetail.description = r.value!;
    }
    if (busDetail.name || busDetail.description) {
      emitAutofillApply(busDetail);
    }

    for (const r of toApply) {
      if (
        r.key === "brand" ||
        r.key === "sku_id" ||
        r.key === "dim_length" ||
        r.key === "dim_width" ||
        r.key === "dim_height" ||
        r.key === "weight_kg"
      ) {
        const input = document.querySelector<HTMLInputElement>(
          `input[name="${r.key}"][form="${formId}"]`,
        );
        if (input) {
          input.value = r.value!;
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
    }

    const oldHiddens = document.querySelectorAll<HTMLInputElement>(
      `input[name="ai_filled_fields"][data-source="spec_sheet"]`,
    );
    for (const old of oldHiddens) old.remove();
    const formEl = document.getElementById(formId);
    if (formEl) {
      for (const r of toApply) {
        const dbKey = mapRowKeyToDbField(r.key);
        if (!dbKey) continue;
        const h = document.createElement("input");
        h.type = "hidden";
        h.name = "ai_filled_fields";
        h.value = dbKey;
        h.dataset.source = "spec_sheet";
        formEl.appendChild(h);
      }
    }

    setAppliedAt(Date.now());
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-violet-200 bg-violet-50/40 p-3">
      <div className="flex flex-col gap-1">
        <div className="text-sm font-semibold text-neutral-800">
          Auto-fill from image
        </div>
        <div className="text-xs text-neutral-500">
          Pick any image with{" "}
          <span className="font-medium">Feed to AI parser</span> turned on (a
          brand spec sheet, product page screenshot, datasheet, even a
          cutout). GPT-4o reads name / brand / SKU / dimensions / weight /
          description; you pick what to apply.
        </div>
      </div>

      {!productId ? (
        <div className="rounded-md bg-neutral-100 px-3 py-2 text-xs text-neutral-500">
          Save the product first, then upload an image.
        </div>
      ) : candidates.length === 0 ? (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
          No images with Feed to AI turned on. Upload one in the Images
          section above and the parser becomes available.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="text-[11px] font-medium text-neutral-700">
            Pick an image:
          </div>
          <div
            className="grid grid-cols-3 gap-2 sm:grid-cols-5"
            role="radiogroup"
            aria-label="Image to parse"
          >
            {candidates.map((c) => {
              const selected = pickedId === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setPickedId(c.id)}
                  className={`relative aspect-square overflow-hidden rounded-md border-2 bg-neutral-50 transition ${
                    selected
                      ? "border-violet-500 ring-1 ring-violet-200"
                      : "border-neutral-200 hover:border-neutral-400"
                  }`}
                >
                  {c.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.previewUrl}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] text-neutral-400">
                      no preview
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={onParse}
            disabled={disabled}
            className="self-start rounded-md border border-violet-300 bg-violet-100 px-3 py-1.5 text-xs font-medium text-violet-800 transition hover:border-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Parsing…" : "Parse selected image"}
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </div>
      )}

      {suggestions && (
        <div className="flex flex-col gap-2 rounded-md border border-violet-200 bg-white p-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-neutral-800">
              Suggestions{" "}
              {costUsd != null && (
                <span className="font-normal text-neutral-500">
                  · est. cost ${costUsd.toFixed(4)}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={onApply}
              disabled={
                pending || suggestions.every((r) => !r.checked || r.value == null)
              }
              className="rounded-md bg-violet-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Apply selected
            </button>
          </div>
          {notes && (
            <div className="rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
              {notes}
            </div>
          )}
          <ul className="flex flex-col gap-1.5 text-xs">
            {suggestions.map((r) => (
              <li
                key={r.key}
                className={`flex items-start gap-2 rounded border border-neutral-200 bg-white px-2 py-1.5 ${r.value == null ? "opacity-50" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={r.checked}
                  disabled={r.value == null}
                  onChange={() => toggleRow(r.key)}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-neutral-700">{r.label}</div>
                  <div className="break-words text-neutral-900">
                    {r.value == null ? (
                      <span className="text-neutral-400">— not on sheet</span>
                    ) : (
                      r.value
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {appliedAt && (
            <div className="text-[11px] text-emerald-700">
              Applied to form. Click Save / Publish to persist.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function mapRowKeyToDbField(key: SuggestionRow["key"]): string | null {
  switch (key) {
    case "name":
    case "brand":
    case "sku_id":
    case "description":
    case "weight_kg":
      return key;
    case "dim_length":
      return "dimensions_mm.length";
    case "dim_width":
      return "dimensions_mm.width";
    case "dim_height":
      return "dimensions_mm.height";
    default:
      return null;
  }
}
