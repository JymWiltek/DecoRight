"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useTransition } from "react";
import {
  CATEGORIES,
  STYLES,
  PRIMARY_COLORS,
  APPLICABLE_SPACES,
  type Category,
  type Style,
  type PrimaryColor,
  type ApplicableSpace,
} from "@/lib/constants/enums";
import {
  CATEGORY_LABELS,
  STYLE_LABELS,
  PRIMARY_COLOR_LABELS,
  PRIMARY_COLOR_HEX,
  APPLICABLE_SPACE_LABELS,
} from "@/lib/constants/enum-labels";

type SortKey = "latest" | "price_asc" | "price_desc";

export default function FilterPanel() {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const current = useMemo(() => {
    return {
      q: params.get("q") ?? "",
      category: (params.get("category") || "") as Category | "",
      styles: (params.get("styles") || "").split(",").filter(Boolean) as Style[],
      colors: (params.get("colors") || "").split(",").filter(Boolean) as PrimaryColor[],
      spaces: (params.get("spaces") || "")
        .split(",")
        .filter(Boolean) as ApplicableSpace[],
      sort: (params.get("sort") || "latest") as SortKey,
    };
  }, [params]);

  const push = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (!v) next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      startTransition(() => {
        router.push(qs ? `/?${qs}` : "/", { scroll: false });
      });
    },
    [params, router],
  );

  const toggleInList = (list: string[], value: string) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  return (
    <aside
      className={`flex flex-col gap-6 text-sm ${pending ? "opacity-70" : ""}`}
      aria-busy={pending}
    >
      <div>
        <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-neutral-500">
          搜索
        </label>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const q = (e.currentTarget.elements.namedItem("q") as HTMLInputElement)
              .value;
            push({ q: q || null });
          }}
        >
          <input
            name="q"
            defaultValue={current.q}
            placeholder="名称、品牌、描述"
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
          />
        </form>
      </div>

      <div>
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
          分类
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip
            active={!current.category}
            onClick={() => push({ category: null })}
            label="全部"
          />
          {CATEGORIES.map((c) => (
            <Chip
              key={c}
              active={current.category === c}
              onClick={() => push({ category: current.category === c ? null : c })}
              label={CATEGORY_LABELS[c]}
            />
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
          风格
        </div>
        <div className="flex flex-wrap gap-2">
          {STYLES.map((s) => {
            const active = current.styles.includes(s);
            return (
              <Chip
                key={s}
                active={active}
                onClick={() => {
                  const next = toggleInList(current.styles, s);
                  push({ styles: next.length ? next.join(",") : null });
                }}
                label={STYLE_LABELS[s]}
              />
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
          主色
        </div>
        <div className="grid grid-cols-5 gap-2">
          {PRIMARY_COLORS.map((c) => {
            const active = current.colors.includes(c);
            return (
              <button
                key={c}
                type="button"
                onClick={() => {
                  const next = toggleInList(current.colors, c);
                  push({ colors: next.length ? next.join(",") : null });
                }}
                aria-pressed={active}
                title={PRIMARY_COLOR_LABELS[c]}
                className={`h-8 w-8 rounded-full border transition ${
                  active
                    ? "border-black ring-2 ring-black ring-offset-1"
                    : "border-neutral-300"
                }`}
                style={{ backgroundColor: PRIMARY_COLOR_HEX[c] }}
              />
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
          空间
        </div>
        <div className="flex flex-wrap gap-2">
          {APPLICABLE_SPACES.map((s) => {
            const active = current.spaces.includes(s);
            return (
              <Chip
                key={s}
                active={active}
                onClick={() => {
                  const next = toggleInList(current.spaces, s);
                  push({ spaces: next.length ? next.join(",") : null });
                }}
                label={APPLICABLE_SPACE_LABELS[s]}
              />
            );
          })}
        </div>
      </div>

      <div>
        <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-neutral-500">
          排序
        </label>
        <select
          value={current.sort}
          onChange={(e) =>
            push({ sort: e.target.value === "latest" ? null : e.target.value })
          }
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
        >
          <option value="latest">最新上架</option>
          <option value="price_asc">价格从低到高</option>
          <option value="price_desc">价格从高到低</option>
        </select>
      </div>

      {(current.q ||
        current.category ||
        current.styles.length ||
        current.colors.length ||
        current.spaces.length ||
        current.sort !== "latest") && (
        <button
          type="button"
          onClick={() =>
            push({
              q: null,
              category: null,
              styles: null,
              colors: null,
              spaces: null,
              sort: null,
            })
          }
          className="self-start rounded-md border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 hover:border-black"
        >
          清除所有筛选
        </button>
      )}
    </aside>
  );
}

function Chip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-xs transition ${
        active
          ? "border-black bg-black text-white"
          : "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-500"
      }`}
    >
      {label}
    </button>
  );
}
