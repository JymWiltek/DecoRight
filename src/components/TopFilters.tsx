"use client";

/**
 * Top pill filter bar for the /c listing page (replaces the left
 * FilterPanel sidebar). A clean single row of pills (Style / Color /
 * Material / Price / Sort) that open a panel BELOW the bar on click —
 * panel-below (not an absolute popover) so it never gets clipped by the
 * mobile horizontal-scroll container. Search + Reset on the right.
 *
 * Reuses the exact URL-key contract the old sidebar used (styles /
 * colors / materials / sort / q, CSV multi-select) + a new single-value
 * `tier` for the Price pill, so server-side filtering is unchanged.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/config";
import { labelFor, type Taxonomy } from "@/lib/taxonomy";
import { PRICE_TIERS } from "@/lib/constants/enums";
import { PRICE_TIER_LABELS } from "@/lib/constants/enum-labels";

type SortKey = "latest" | "price_asc" | "price_desc";
type PillKey = "styles" | "colors" | "materials" | "tier" | "sort";

export default function TopFilters({ taxonomy }: { taxonomy: Taxonomy }) {
  const t = useTranslations("filters");
  const locale = useLocale() as Locale;
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
      materials: splitCsv(params.get("materials")),
      tier: params.get("tier") ?? "",
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

  const toggleCsv = (key: "styles" | "colors" | "materials", value: string) => {
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
    current.materials.length ||
    current.tier ||
    current.sort !== "latest";

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

  const sortLabels: Record<SortKey, string> = {
    latest: t("sortLatest"),
    price_asc: t("sortPriceAsc"),
    price_desc: t("sortPriceDesc"),
  };

  return (
    <div className={`mb-6 ${pending ? "opacity-70" : ""}`} aria-busy={pending}>
      <div className="flex items-center gap-2">
        <div className="flex grow gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {pill("styles", t("style"), current.styles.length)}
          {pill("colors", t("color"), current.colors.length)}
          {pill("materials", t("material"), current.materials.length)}
          {pill(
            "tier",
            t("price"),
            0,
            current.tier ? PRICE_TIER_LABELS[current.tier as keyof typeof PRICE_TIER_LABELS] : undefined,
          )}
          {pill(
            "sort",
            t("sort"),
            0,
            current.sort !== "latest" ? sortLabels[current.sort] : undefined,
          )}
        </div>

        {/* Search (inline on sm+) */}
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
              push({ q: null, styles: null, colors: null, materials: null, tier: null, sort: null });
            }}
            className="shrink-0 rounded-full border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 hover:border-black"
          >
            {t("clearAll")}
          </button>
        )}
      </div>

      {/* Search (full-width row on mobile) */}
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

      {/* Panel below the bar — never clipped by the scroll row. */}
      {open && (
        <div className="mt-3 rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
          {open === "styles" && (
            <ChipPanel
              options={taxonomy.styles.map((r) => ({ slug: r.slug, label: labelFor(r, locale) }))}
              selected={current.styles}
              onToggle={(s) => toggleCsv("styles", s)}
            />
          )}
          {open === "materials" && (
            <ChipPanel
              options={taxonomy.materials.map((r) => ({ slug: r.slug, label: labelFor(r, locale) }))}
              selected={current.materials}
              onToggle={(s) => toggleCsv("materials", s)}
            />
          )}
          {open === "colors" && (
            <div className="flex flex-wrap gap-2">
              {taxonomy.colors.map((c) => {
                const active = current.colors.includes(c.slug);
                const lbl = labelFor(c, locale);
                return (
                  <button
                    key={c.slug}
                    type="button"
                    onClick={() => toggleCsv("colors", c.slug)}
                    aria-pressed={active}
                    title={lbl}
                    aria-label={lbl}
                    className={`h-8 w-8 rounded-full border transition ${
                      active ? "border-black ring-2 ring-black ring-offset-1" : "border-neutral-300"
                    }`}
                    style={{ backgroundColor: c.hex }}
                  />
                );
              })}
            </div>
          )}
          {open === "tier" && (
            <div className="flex flex-wrap gap-2">
              {PRICE_TIERS.map((tier) => {
                const active = current.tier === tier;
                return (
                  <button
                    key={tier}
                    type="button"
                    onClick={() => {
                      push({ tier: active ? null : tier });
                      setOpen(null);
                    }}
                    aria-pressed={active}
                    className={pillBtn(active)}
                  >
                    {PRICE_TIER_LABELS[tier]}
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

function ChipPanel({
  options,
  selected,
  onToggle,
}: {
  options: { slug: string; label: string }[];
  selected: string[];
  onToggle: (slug: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.slug}
          type="button"
          onClick={() => onToggle(o.slug)}
          aria-pressed={selected.includes(o.slug)}
          className={pillBtn(selected.includes(o.slug))}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function splitCsv(v: string | null): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}
