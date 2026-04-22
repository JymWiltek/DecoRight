"use client";

import { deleteTaxonomyItem } from "./actions";

type Props = {
  kind: "item_types" | "rooms" | "styles" | "materials" | "colors";
  slug: string;
  label: string;
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
 * One taxonomy pill with a delete (×) button.
 *
 * The × button is destructive and easy to mis-click, so we intercept the
 * form submit on the client and show a native confirm(). The server action
 * ALSO checks product references before actually deleting, so even if the
 * dialog is bypassed we never orphan data. Two layers of protection.
 */
export default function DeleteChip({ kind, slug, label, hex }: Props) {
  return (
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
      className="inline-flex items-center gap-1 rounded-full border border-neutral-300 px-3 py-1 text-xs"
    >
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="slug" value={slug} />
      {hex && (
        <span
          className="h-3 w-3 rounded-full border border-neutral-300"
          style={{ backgroundColor: hex }}
        />
      )}
      <span>{label}</span>
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
  );
}
