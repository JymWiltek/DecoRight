"use client";

/**
 * Wave 3 — admin UI block: upload a brand spec sheet image, run it
 * through GPT-4o vision via the parseSpecSheetAction server action,
 * and let the operator selectively apply each suggested field to the
 * product form.
 *
 * UX flow:
 *   1. Operator picks a spec sheet (JPEG/PNG/WebP, ≤ 8 MB).
 *   2. Click "Parse spec sheet". The action uploads the image to
 *      raw-images storage with image_kind='spec_sheet' (so it stays
 *      private + invisible to storefront), forwards to GPT-4o, and
 *      returns the structured suggestions.
 *   3. Suggestions render in a card with one row per field. Each
 *      row shows the AI value + a checkbox (default ON when the AI
 *      returned a non-null value, OFF otherwise).
 *   4. "Apply selected" button writes the checked fields into the
 *      form:
 *        - name / description → emit via the existing autofill bus
 *          (AutofillTextInput / AutofillTextarea listen for it).
 *        - brand / sku_id / dim_* / weight_kg → directly set the
 *          underlying <input>'s value (those are uncontrolled).
 *      ai_filled_fields hidden inputs are emitted for each applied
 *      field so the server action persists the audit list.
 *
 * Note about file uploads in server actions: this calls the action
 * with a FormData containing the spec_image. Per Next 15+ semantics,
 * server actions accept multipart payloads transparently — no special
 * client wiring needed beyond constructing the FormData. The
 * experimental.serverActions.bodySizeLimit in next.config.ts (10 MB)
 * is sufficient for an 8 MB spec sheet.
 *
 * Why a NEW component instead of extending AIInferButton: Jym
 * explicitly asked we not change the existing photo-classifier
 * "Auto-classify from photo" logic. This block is the new
 * "Auto-fill from spec sheet" surface — different inputs, different
 * outputs, different review UI.
 */

import { useRef, useState, useTransition } from "react";
import { parseSpecSheetAction, type ParseSpecSheetResult } from "@/app/admin/(dashboard)/products/actions";
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

type Props = {
  /** Required — the action persists the spec image into product_images. */
  productId: string | null;
  /** id attribute of the outer ProductForm <form>. We append hidden
   *  ai_filled_fields inputs there after Apply so the server action
   *  picks them up at Save time. */
  formId: string;
};

export default function SpecSheetAutofillBlock({ productId, formId }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<File | null>(null);
  const [pending, startTransition] = useTransition();
  const [suggestions, setSuggestions] = useState<SuggestionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [costUsd, setCostUsd] = useState<number | null>(null);
  const [notes, setNotes] = useState<string>("");
  const [appliedAt, setAppliedAt] = useState<number | null>(null);

  const disabled = !productId || pending;

  function onPick(f: File | null) {
    setPicked(f);
    setError(null);
    setSuggestions(null);
  }

  function onParse() {
    if (!productId || !picked) return;
    setError(null);
    setSuggestions(null);
    setCostUsd(null);
    setNotes("");
    setAppliedAt(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("spec_image", picked);
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

    // Split: name/description go through the autofill bus (their
    // inputs are React-controlled via AutofillTextInput).
    const busDetail: { name?: string; description?: string } = {};
    for (const r of toApply) {
      if (r.key === "name") busDetail.name = r.value!;
      if (r.key === "description") busDetail.description = r.value!;
    }
    if (busDetail.name || busDetail.description) {
      emitAutofillApply(busDetail);
    }

    // Direct DOM set for the uncontrolled inputs (brand, sku_id,
    // dim_*, weight_kg). Setting input.value directly works because
    // these inputs are NOT React-controlled — ProductForm renders
    // them as plain <input defaultValue=…>.
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
          // Dispatch a synthetic input event so any listeners (none
          // today, but cheap insurance) see the change.
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
    }

    // Stamp ai_filled_fields hidden inputs onto the form so
    // updateProduct's parsePayload picks them up at Save time.
    // Remove any prior ones we wrote — multiple Apply clicks shouldn't
    // pile up duplicate keys (though the server-side Set dedups them
    // either way, this keeps the DOM clean for inspection).
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
          Auto-fill from spec sheet
        </div>
        <div className="text-xs text-neutral-500">
          Upload a brand spec sheet (JPEG / PNG / WebP, ≤ 8 MB). GPT-4o reads
          name / brand / SKU / dimensions / weight / description, you pick
          what to apply.
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={disabled}
          onChange={(e) => onPick(e.currentTarget.files?.[0] ?? null)}
          className="text-xs"
        />
        <button
          type="button"
          onClick={onParse}
          disabled={disabled || !picked}
          className="rounded-md border border-violet-300 bg-violet-100 px-3 py-1.5 text-xs font-medium text-violet-800 transition hover:border-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Parsing…" : "Parse spec sheet"}
        </button>
        {!productId && (
          <span className="text-xs text-neutral-500">
            Save the product first, then parse a spec.
          </span>
        )}
      </div>

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

/**
 * Translate a UI row key into the DB column name that
 * ai_filled_fields persists. Returns null for keys that don't map
 * (none today, but defensive — adding a UI-only key shouldn't
 * silently get persisted with the same name).
 */
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
