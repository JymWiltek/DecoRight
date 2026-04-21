"use client";

import { deleteTaxonomyItem } from "./actions";

type Props = {
  kind: "item_types" | "rooms" | "styles" | "materials" | "colors";
  slug: string;
  label: string;
  hex?: string;
};

const KIND_LABELS: Record<Props["kind"], string> = {
  item_types: "物件类型",
  rooms: "房间",
  styles: "风格",
  materials: "材质",
  colors: "颜色",
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
          `确定删除${KIND_LABELS[kind]}「${label}」？\n\n` +
            `如果有商品在用，系统会阻止删除。\n` +
            `想暂时隐藏它而不删除，建议先改掉商品里用到它的地方。`,
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
        title="删除"
        aria-label={`删除 ${label}`}
      >
        ×
      </button>
    </form>
  );
}
