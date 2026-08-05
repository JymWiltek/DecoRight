"use client";

/**
 * Layer 3 — the human "change provenance" control on an image card. A
 * `<select>` that submits its wrapping `<form action={setImageProvenance}>`
 * on change (same server-component + client-event split as
 * ImageToggleCheckbox). Setting it records provenance_by='manual', which no
 * automatic layer may overwrite.
 */
import type { ImageProvenance } from "@/lib/supabase/types";

type Props = {
  formId: string;
  current: ImageProvenance | null;
  choices: ImageProvenance[];
  labels: Record<ImageProvenance | "unknown", string>;
};

export default function ProvenanceSelect({ formId, current, choices, labels }: Props) {
  return (
    <select
      name="value"
      defaultValue={current ?? ""}
      onChange={(e) => {
        if (!e.target.value) return;
        const form = document.getElementById(formId);
        if (form instanceof HTMLFormElement) form.requestSubmit();
      }}
      className="rounded border border-neutral-300 bg-white px-1 py-0.5 text-[11px] text-neutral-700"
    >
      <option value="" disabled>
        {labels.unknown}
      </option>
      {choices.map((c) => (
        <option key={c} value={c}>
          {labels[c]}
        </option>
      ))}
    </select>
  );
}
