"use client";

import { useState } from "react";
import { deleteTaxonomyItem, updateTaxonomyLabels } from "./actions";

type Kind = "item_types" | "rooms" | "styles" | "materials" | "colors";

type Props = {
  kind: Kind;
  slug: string;
  /** Canonical label (label_en) — always present. */
  label: string;
  /** Chinese translation, null if not yet auto-translated. */
  labelZh: string | null;
  /** Malay translation, null if not yet auto-translated. */
  labelMs: string | null;
  hex?: string;
};

const KIND_LABELS: Record<Kind, string> = {
  item_types: "item type",
  rooms: "room",
  styles: "style",
  materials: "material",
  colors: "color",
};

/**
 * One taxonomy pill with three controls:
 *   - edit (pencil)  → expand into a tri-lingual inline form (F3).
 *   - delete (×)     → native confirm(), then server-side guard.
 *   - ZH/MS status line below the label so missing translations
 *     pop out at a glance (amber when both missing).
 *
 * Why inline edit lives on every chip, not just on rooms:
 *   The original ask was F3 (rooms can't be edited — Balcony shipped
 *   with no ZH/MS and there was no admin path to fix it). Making it
 *   rooms-only would create a weird capability gap — same data shape,
 *   different UI. Uniform is simpler and cheap: every label-bearing
 *   row gets the same editor.
 *
 * Why a native form and not a Dialog / modal:
 *   Server actions work best with `<form action={…}>` posts — no
 *   client state plumbing, no useTransition, no race against
 *   revalidatePath. The chip just toggles between view mode and a
 *   3-input form. Save triggers a full server round-trip, the row
 *   re-renders with the new labels. Cancel just collapses.
 */
export default function DeleteChip({
  kind,
  slug,
  label,
  labelZh,
  labelMs,
  hex,
}: Props) {
  const [editing, setEditing] = useState(false);
  const bothMissing = labelZh == null && labelMs == null;

  if (editing) {
    return (
      <form
        action={updateTaxonomyLabels}
        className="inline-flex flex-col gap-1 rounded-md border border-sky-400 bg-sky-50 px-2.5 py-2 text-xs"
      >
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="slug" value={slug} />
        <label className="flex items-center gap-1">
          <span className="w-5 text-[10px] text-neutral-500">EN</span>
          <input
            name="label_en"
            defaultValue={label}
            required
            className="w-36 rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-xs focus:border-black focus:outline-none"
          />
        </label>
        <label className="flex items-center gap-1">
          <span className="w-5 text-[10px] text-neutral-500">ZH</span>
          <input
            name="label_zh"
            defaultValue={labelZh ?? ""}
            placeholder="中文"
            className="w-36 rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-xs focus:border-black focus:outline-none"
          />
        </label>
        <label className="flex items-center gap-1">
          <span className="w-5 text-[10px] text-neutral-500">MS</span>
          <input
            name="label_ms"
            defaultValue={labelMs ?? ""}
            placeholder="Bahasa Melayu"
            className="w-36 rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-xs focus:border-black focus:outline-none"
          />
        </label>
        <div className="mt-1 flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded border border-neutral-300 bg-white px-2 py-0.5 text-[11px] text-neutral-700 hover:border-neutral-500"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded bg-black px-2 py-0.5 text-[11px] font-medium text-white hover:bg-neutral-800"
          >
            Save
          </button>
        </div>
      </form>
    );
  }

  return (
    <div
      className={`inline-flex flex-col rounded-md border px-2.5 py-1.5 text-xs ${
        bothMissing
          ? "border-amber-300 bg-amber-50"
          : "border-neutral-300 bg-white"
      }`}
    >
      <form
        action={deleteTaxonomyItem}
        onSubmit={(e) => {
          const ok = window.confirm(
            `Delete ${KIND_LABELS[kind]} "${label}"?\n\n` +
              `If any product still uses it, the server will block the delete.\n` +
              `To hide an option without removing it, reassign the products that use it first.`,
          );
          if (!ok) e.preventDefault();
        }}
        className="inline-flex items-center gap-1"
      >
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="slug" value={slug} />
        {hex && (
          <span
            className="h-3 w-3 rounded-full border border-neutral-300"
            style={{ backgroundColor: hex }}
          />
        )}
        <span className="font-medium">{label}</span>
        <span className="text-neutral-400">· {slug}</span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="ml-1 text-neutral-400 hover:text-sky-600"
          title="Edit labels"
          aria-label={`Edit ${label}`}
        >
          ✎
        </button>
        <button
          type="submit"
          className="text-neutral-400 hover:text-rose-600"
          title="Delete"
          aria-label={`Delete ${label}`}
        >
          ×
        </button>
      </form>
      <div className="mt-0.5 flex gap-2 text-[10px] leading-tight text-neutral-500">
        <span className={labelZh ? "" : "text-amber-600"}>
          ZH: {labelZh ?? "—"}
        </span>
        <span className={labelMs ? "" : "text-amber-600"}>
          MS: {labelMs ?? "—"}
        </span>
      </div>
    </div>
  );
}
