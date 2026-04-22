"use client";

import { deleteTaxonomyItem } from "./actions";

type Props = {
  kind: "item_types" | "rooms" | "styles" | "materials" | "colors";
  slug: string;
  /** Canonical label (label_zh) — always present. */
  label: string;
  /** English translation, null if not yet auto-translated. */
  labelEn: string | null;
  /** Malay translation, null if not yet auto-translated. */
  labelMs: string | null;
  hex?: string;
};

const KIND_LABELS: Record<Props["kind"], string> = {
  item_types: "item type",
  rooms: "room",
  styles: "style",
  materials: "material",
  colors: "color",
};

/**
 * One taxonomy pill with a delete (×) button plus a compact i18n status
 * line showing the EN / MS translations (or a dash when null). The
 * canonical zh label is the chip's own text; translations sit below it
 * so an admin can spot what's missing at a glance.
 *
 * The × button is destructive and easy to mis-click, so we intercept the
 * form submit on the client and show a native confirm(). The server
 * action ALSO checks product references before actually deleting — two
 * layers of protection.
 */
export default function DeleteChip({
  kind,
  slug,
  label,
  labelEn,
  labelMs,
  hex,
}: Props) {
  const bothMissing = labelEn == null && labelMs == null;
  const oneMissing = !bothMissing && (labelEn == null || labelMs == null);

  return (
    <div
      className={`inline-flex flex-col rounded-md border px-2.5 py-1.5 text-xs ${
        bothMissing
          ? "border-amber-300 bg-amber-50"
          : oneMissing
            ? "border-neutral-300 bg-white"
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
          type="submit"
          className="ml-1 text-neutral-400 hover:text-rose-600"
          title="Delete"
          aria-label={`Delete ${label}`}
        >
          ×
        </button>
      </form>
      <div className="mt-0.5 flex gap-2 text-[10px] leading-tight text-neutral-500">
        <span className={labelEn ? "" : "text-amber-600"}>
          EN: {labelEn ?? "—"}
        </span>
        <span className={labelMs ? "" : "text-amber-600"}>
          MS: {labelMs ?? "—"}
        </span>
      </div>
    </div>
  );
}
