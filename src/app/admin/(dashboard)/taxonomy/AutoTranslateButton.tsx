"use client";

import { useTransition } from "react";
import { translateMissingTaxonomy } from "./actions";

type Props = {
  /** Count of rows currently missing at least one of label_en / label_ms.
   *  Shown in the button label so the admin knows the scale before clicking. */
  missingCount: number;
};

/**
 * Kicks off a Claude Sonnet 4.5 batch translation run for every taxonomy
 * row where label_en or label_ms is null. The server action redirects
 * back to /admin/taxonomy with `?translated=N`, so the page re-renders
 * itself — we just show a pending spinner while we wait.
 *
 * Disabled when there's nothing to translate. Safe to click multiple
 * times: the action only ever writes into null columns, never overwrites.
 */
export default function AutoTranslateButton({ missingCount }: Props) {
  const [pending, startTransition] = useTransition();
  const disabled = pending || missingCount === 0;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => startTransition(() => translateMissingTaxonomy())}
      className="inline-flex items-center gap-2 rounded-md border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 hover:border-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending
        ? "Translating…"
        : missingCount === 0
          ? "All labels translated"
          : `Auto-translate missing (${missingCount})`}
    </button>
  );
}
