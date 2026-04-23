"use client";

import { deleteSubtype } from "./actions";

/**
 * Migration 0013: subtype no longer owns a room. The chip is now
 * item_type + label + ZH/MS status only.
 */
type Props = {
  itemTypeSlug: string;
  slug: string;
  label: string;
  labelZh: string | null;
  labelMs: string | null;
};

export default function SubtypeChip({
  itemTypeSlug,
  slug,
  label,
  labelZh,
  labelMs,
}: Props) {
  const bothMissing = labelZh == null && labelMs == null;

  return (
    <div
      className={`inline-flex flex-col rounded-md border px-2.5 py-1.5 text-xs ${
        bothMissing
          ? "border-amber-300 bg-amber-50"
          : "border-neutral-300 bg-white"
      }`}
    >
      <form
        action={deleteSubtype}
        onSubmit={(e) => {
          const ok = window.confirm(
            `Delete subtype "${label}" (under ${itemTypeSlug})?\n\nIf any product still uses it, the server will block the delete.`,
          );
          if (!ok) e.preventDefault();
        }}
        className="inline-flex items-center gap-1"
      >
        <input type="hidden" name="item_type_slug" value={itemTypeSlug} />
        <input type="hidden" name="slug" value={slug} />
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
