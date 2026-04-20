"use client";

import type { ColorVariant } from "@/lib/supabase/types";

type Props = {
  variants: ColorVariant[];
  activeIndex: number;
  onChange: (index: number) => void;
};

export default function ColorSwitcher({ variants, activeIndex, onChange }: Props) {
  if (variants.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm text-neutral-600">颜色</div>
      <div className="flex flex-wrap gap-3">
        {variants.map((v, i) => {
          const active = i === activeIndex;
          return (
            <button
              key={`${v.name}-${i}`}
              type="button"
              onClick={() => onChange(i)}
              aria-label={v.name}
              aria-pressed={active}
              title={v.name}
              className={`relative h-10 w-10 rounded-full border transition ${
                active ? "border-black ring-2 ring-black ring-offset-2" : "border-neutral-300"
              }`}
              style={{ backgroundColor: v.hex }}
            />
          );
        })}
      </div>
      <div className="text-sm text-neutral-700">{variants[activeIndex]?.name}</div>
    </div>
  );
}
