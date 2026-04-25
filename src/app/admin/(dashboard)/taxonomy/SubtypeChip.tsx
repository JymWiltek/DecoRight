"use client";

import { useState } from "react";
import { deleteSubtype, updateSubtypeLabels } from "./actions";
import TriLingualLabel from "@/components/admin/TriLingualLabel";

/**
 * Migration 0013: subtype no longer owns a room. The chip is now
 * item_type + label + ZH/MS status only.
 *
 * Now mirrors DeleteChip (rooms / styles / materials / colors):
 * a 3-row tri-lingual stack with inline edit pencil so an operator
 * can fix a missing translation without leaving the page.
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
  const [editing, setEditing] = useState(false);
  const anyMissing = labelZh == null || labelMs == null;

  if (editing) {
    return (
      <form
        action={updateSubtypeLabels}
        className="inline-flex flex-col gap-1 rounded-md border border-sky-400 bg-sky-50 px-2.5 py-2 text-xs"
      >
        <input type="hidden" name="item_type_slug" value={itemTypeSlug} />
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
      className={`inline-flex flex-col rounded-md border px-3 py-2 ${
        anyMissing
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
        className="inline-flex items-start gap-2"
      >
        <input type="hidden" name="item_type_slug" value={itemTypeSlug} />
        <input type="hidden" name="slug" value={slug} />
        <TriLingualLabel en={label} zh={labelZh} ms={labelMs} />
        <div className="ml-1 flex flex-col items-end gap-0.5 text-neutral-400">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-sm hover:text-sky-600"
            title="Edit labels"
            aria-label={`Edit ${label}`}
          >
            ✎
          </button>
          <button
            type="submit"
            className="text-sm hover:text-rose-600"
            title="Delete"
            aria-label={`Delete ${label}`}
          >
            ×
          </button>
        </div>
      </form>
      <div className="mt-1 text-[10px] text-neutral-400">{slug}</div>
    </div>
  );
}
