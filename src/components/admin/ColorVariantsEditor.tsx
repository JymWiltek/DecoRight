"use client";

import { useState } from "react";
import type { ColorVariant } from "@/lib/supabase/types";

type Props = {
  name: string;
  initial: ColorVariant[];
};

export default function ColorVariantsEditor({ name, initial }: Props) {
  const [rows, setRows] = useState<ColorVariant[]>(initial);

  const update = (i: number, patch: Partial<ColorVariant>) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  const add = () =>
    setRows((prev) => [
      ...prev,
      { name: "", hex: "#CCCCCC", price_adjustment_myr: 0, purchase_url_override: null },
    ]);

  const remove = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));

  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name={name} value={JSON.stringify(rows)} />
      {rows.length === 0 && (
        <div className="rounded-md border border-dashed border-neutral-300 px-3 py-4 text-center text-xs text-neutral-500">
          暂无色变，点击下方添加
        </div>
      )}
      {rows.map((r, i) => (
        <div
          key={i}
          className="grid grid-cols-[auto_1fr_1fr_1fr_auto] items-center gap-2 rounded-md border border-neutral-200 p-2"
        >
          <input
            type="color"
            value={r.hex}
            onChange={(e) => update(i, { hex: e.target.value.toUpperCase() })}
            className="h-8 w-8 rounded border border-neutral-300"
          />
          <input
            type="text"
            placeholder="名称 e.g. Chrome"
            value={r.name}
            onChange={(e) => update(i, { name: e.target.value })}
            className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
          />
          <input
            type="number"
            placeholder="差价 RM"
            value={r.price_adjustment_myr}
            onChange={(e) => update(i, { price_adjustment_myr: Number(e.target.value) || 0 })}
            className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
          />
          <input
            type="url"
            placeholder="购买链接 (可选，覆盖主链接)"
            value={r.purchase_url_override ?? ""}
            onChange={(e) =>
              update(i, { purchase_url_override: e.target.value || null })
            }
            className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
          />
          <button
            type="button"
            onClick={() => remove(i)}
            className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:border-red-400 hover:text-red-600"
          >
            删除
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="self-start rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:border-black"
      >
        + 添加色变
      </button>
    </div>
  );
}
