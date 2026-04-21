"use client";

export type ColorOption = { slug: string; label: string; hex: string };

type Props = {
  colors: ColorOption[];
  activeIndex: number;
  onChange: (index: number) => void;
};

export default function ColorSwitcher({ colors, activeIndex, onChange }: Props) {
  if (colors.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm text-neutral-600">颜色</div>
      <div className="flex flex-wrap gap-3">
        {colors.map((c, i) => {
          const active = i === activeIndex;
          return (
            <button
              key={c.slug}
              type="button"
              onClick={() => onChange(i)}
              aria-label={c.label}
              aria-pressed={active}
              title={c.label}
              className={`relative h-10 w-10 rounded-full border transition ${
                active
                  ? "border-black ring-2 ring-black ring-offset-2"
                  : "border-neutral-300"
              }`}
              style={{ backgroundColor: c.hex }}
            />
          );
        })}
      </div>
      <div className="text-sm text-neutral-700">{colors[activeIndex]?.label}</div>
    </div>
  );
}
