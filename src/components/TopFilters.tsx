"use client";

/**
 * Top pill filter bar for the /c listing page. FINAL set: Style | Color |
 * Sort (Material + Price removed). Style + Color are multi-select; Sort is
 * single. Options are computed per-category-in-stock on the server and passed
 * in via `styleOptions` / `colorOptions` — NOT the full taxonomy — so a pill
 * only ever shows values that actually have products in the current category
 * (and the whole pill hides when that category has none). Color options render
 * a swatch AND its name. URL contract unchanged (styles/colors CSV, sort, q).
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";

type SortKey = "latest" | "price_asc" | "price_desc";
type PillKey = "styles" | "colors" | "sort";

export type StyleOption = { slug: string; label: string };
export type ColorOption = { slug: string; label: string; hex: string };

export default function TopFilters({
  styleOptions,
  colorOptions,
}: {
  styleOptions: StyleOption[];
  colorOptions: ColorOption[];
}) {
  const t = useTranslations("filters");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState<PillKey | null>(null);

  const current = useMemo(
    () => ({
      q: params.get("q") ?? "",
      styles: splitCsv(params.get("styles")),
      colors: splitCsv(params.get("colors")),
      sort: (params.get("sort") || "latest") as SortKey,
    }),
    [params],
  );

  const push = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (!v) next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      startTransition(() => {
        router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      });
    },
    [params, pathname, router],
  );

  const toggleCsv = (key: "styles" | "colors", value: string) => {
    const list = current[key];
    const next = list.includes(value)
      ? list.filter((v) => v !== value)
      : [...list, value];
    push({ [key]: next.length ? next.join(",") : null });
  };

  const hasAny =
    current.q ||
    current.styles.length ||
    current.colors.length ||
    current.sort !== "latest";

  const sortLabels: Record<SortKey, string> = {
    latest: t("sortLatest"),
    price_asc: t("sortPriceAsc"),
    price_desc: t("sortPriceDesc"),
  };

  const pill = (key: PillKey, label: string, count: number, activeText?: string) => (
    <button
      type="button"
      onClick={() => setOpen(open === key ? null : key)}
      aria-expanded={open === key}
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition ${
        count > 0 || activeText
          ? "border-black bg-black text-white"
          : "border-neutral-300 bg-white text-neutral-700 hover:border-black"
      }`}
    >
      {label}
      {count > 0 && <span className="tabular-nums">· {count}</span>}
      {activeText && <span>· {activeText}</span>}
      <svg
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        aria-hidden
        className={open === key ? "rotate-180 transition" : "transition"}
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
  );

  return (
    <div className={`mb-6 ${pending ? "opacity-70" : ""}`} aria-busy={pending}>
      <div className="flex items-center gap-2">
        <div className="flex grow gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {/* Hide the pill entirely when the category has 0 of that facet. */}
          {styleOptions.length > 0 && pill("styles", t("style"), current.styles.length)}
          {colorOptions.length > 0 && pill("colors", t("color"), current.colors.length)}
          {pill(
            "sort",
            t("sort"),
            0,
            current.sort !== "latest" ? sortLabels[current.sort] : undefined,
          )}
        </div>

        <form
          className="hidden sm:block"
          onSubmit={(e) => {
            e.preventDefault();
            const q = (e.currentTarget.elements.namedItem("q") as HTMLInputElement).value;
            push({ q: q || null });
          }}
        >
          <input
            name="q"
            defaultValue={current.q}
            placeholder={t("searchPlaceholder")}
            className="w-44 rounded-full border border-neutral-300 px-3 py-1.5 text-xs focus:border-black focus:outline-none"
          />
        </form>

        {hasAny && (
          <button
            type="button"
            onClick={() => {
              setOpen(null);
              push({ q: null, styles: null, colors: null, sort: null });
            }}
            className="shrink-0 rounded-full border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 hover:border-black"
          >
            {t("clearAll")}
          </button>
        )}
      </div>

      <form
        className="mt-2 sm:hidden"
        onSubmit={(e) => {
          e.preventDefault();
          const q = (e.currentTarget.elements.namedItem("q") as HTMLInputElement).value;
          push({ q: q || null });
        }}
      >
        <input
          name="q"
          defaultValue={current.q}
          placeholder={t("searchPlaceholder")}
          className="w-full rounded-full border border-neutral-300 px-3 py-1.5 text-sm focus:border-black focus:outline-none"
        />
      </form>

      {open && (
        <div className="mt-3 rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
          {open === "styles" && (
            <div className="flex flex-wrap gap-2">
              {styleOptions.map((o) => (
                <button
                  key={o.slug}
                  type="button"
                  onClick={() => toggleCsv("styles", o.slug)}
                  aria-pressed={current.styles.includes(o.slug)}
                  className={pillBtn(current.styles.includes(o.slug))}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
          {open === "colors" && (
            <div className="flex flex-wrap gap-2">
              {colorOptions.map((c) => {
                const active = current.colors.includes(c.slug);
                return (
                  <button
                    key={c.slug}
                    type="button"
                    onClick={() => toggleCsv("colors", c.slug)}
                    aria-pressed={active}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition ${
                      active
                        ? "border-black bg-black text-white"
                        : "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-500"
                    }`}
                  >
                    <span
                      className="h-4 w-4 shrink-0 rounded-full border border-neutral-300"
                      style={{ backgroundColor: c.hex }}
                    />
                    {c.label}
                  </button>
                );
              })}
            </div>
          )}
          {open === "sort" && (
            <div className="flex flex-wrap gap-2">
              {(Object.keys(sortLabels) as SortKey[]).map((val) => {
                const active = current.sort === val;
                return (
                  <button
                    key={val}
                    type="button"
                    onClick={() => {
                      push({ sort: val === "latest" ? null : val });
                      setOpen(null);
                    }}
                    aria-pressed={active}
                    className={pillBtn(active)}
                  >
                    {sortLabels[val]}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function pillBtn(active: boolean): string {
  return `rounded-full border px-3 py-1 text-xs transition ${
    active
      ? "border-black bg-black text-white"
      : "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-500"
  }`;
}

function splitCsv(v: string | null): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}
