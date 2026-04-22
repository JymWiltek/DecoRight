"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/config";
import { labelFor, type Taxonomy } from "@/lib/taxonomy";

type SortKey = "latest" | "price_asc" | "price_desc";

type Props = {
  taxonomy: Taxonomy;
  /** Hide filter groups that are already fixed by the current route.
   *  On /item/[slug] the item_type and its parent room are implicit
   *  from the URL — we don't want the user to pick another one here
   *  (that's what navigating back up to the room/home page is for). */
  hide?: { itemType?: boolean; room?: boolean };
};

export default function FilterPanel({ taxonomy, hide }: Props) {
  const t = useTranslations("filters");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const current = useMemo(
    () => ({
      q: params.get("q") ?? "",
      itemTypes: splitCsv(params.get("item_types")),
      rooms: splitCsv(params.get("rooms")),
      styles: splitCsv(params.get("styles")),
      colors: splitCsv(params.get("colors")),
      materials: splitCsv(params.get("materials")),
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
        // Stay on the current route — FilterPanel is shared between
        // the rooms landing (historical), the item-type page, and any
        // future filtered views. Hard-coding "/" sent every filter
        // click back to the rooms grid, blowing away the user's
        // position in the funnel.
        router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      });
    },
    [params, pathname, router],
  );

  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const hasAny =
    current.q ||
    current.itemTypes.length ||
    current.rooms.length ||
    current.styles.length ||
    current.colors.length ||
    current.materials.length ||
    current.sort !== "latest";

  return (
    <aside
      className={`flex flex-col gap-6 text-sm ${pending ? "opacity-70" : ""}`}
      aria-busy={pending}
    >
      <div>
        <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-neutral-500">
          {t("search")}
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
            placeholder={t("searchPlaceholder")}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
          />
        </form>
      </div>

      {!hide?.itemType && (
        <Group
          label={t("itemType")}
          options={taxonomy.itemTypes.map((r) => ({
            slug: r.slug,
            label: labelFor(r, locale),
          }))}
          selected={current.itemTypes}
          onToggle={(s) => {
            const next = toggle(current.itemTypes, s);
            push({ item_types: next.length ? next.join(",") : null });
          }}
        />
      )}

      {!hide?.room && (
        <Group
          label={t("room")}
          options={taxonomy.rooms.map((r) => ({
            slug: r.slug,
            label: labelFor(r, locale),
          }))}
          selected={current.rooms}
          onToggle={(s) => {
            const next = toggle(current.rooms, s);
            push({ rooms: next.length ? next.join(",") : null });
          }}
        />
      )}

      <Group
        label={t("style")}
        options={taxonomy.styles.map((r) => ({
          slug: r.slug,
          label: labelFor(r, locale),
        }))}
        selected={current.styles}
        onToggle={(s) => {
          const next = toggle(current.styles, s);
          push({ styles: next.length ? next.join(",") : null });
        }}
      />

      <div>
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
          {t("color")}
        </div>
        <div className="flex flex-wrap gap-2">
          {taxonomy.colors.map((c) => {
            const active = current.colors.includes(c.slug);
            const lbl = labelFor(c, locale);
            return (
              <button
                key={c.slug}
                type="button"
                onClick={() => {
                  const next = toggle(current.colors, c.slug);
                  push({ colors: next.length ? next.join(",") : null });
                }}
                aria-pressed={active}
                aria-label={lbl}
                title={lbl}
                className={`h-8 w-8 rounded-full border transition ${
                  active
                    ? "border-black ring-2 ring-black ring-offset-1"
                    : "border-neutral-300"
                }`}
                style={{ backgroundColor: c.hex }}
              />
            );
          })}
        </div>
      </div>

      <Group
        label={t("material")}
        options={taxonomy.materials.map((r) => ({
          slug: r.slug,
          label: labelFor(r, locale),
        }))}
        selected={current.materials}
        onToggle={(s) => {
          const next = toggle(current.materials, s);
          push({ materials: next.length ? next.join(",") : null });
        }}
      />

      <div>
        <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-neutral-500">
          {t("sort")}
        </label>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["latest", t("sortLatest")],
              ["price_asc", t("sortPriceAsc")],
              ["price_desc", t("sortPriceDesc")],
            ] as const
          ).map(([val, label]) => (
            <button
              key={val}
              type="button"
              onClick={() => push({ sort: val === "latest" ? null : val })}
              aria-pressed={current.sort === val}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                current.sort === val
                  ? "border-black bg-black text-white"
                  : "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-500"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {hasAny && (
        <button
          type="button"
          onClick={() =>
            push({
              q: null,
              item_types: null,
              rooms: null,
              styles: null,
              colors: null,
              materials: null,
              sort: null,
            })
          }
          className="self-start rounded-md border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 hover:border-black"
        >
          {t("clearAll")}
        </button>
      )}
    </aside>
  );
}

function splitCsv(v: string | null): string[] {
  return (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function Group({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: { slug: string; label: string }[];
  selected: string[];
  onToggle: (slug: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div>
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const active = selected.includes(o.slug);
          return (
            <button
              key={o.slug}
              type="button"
              onClick={() => onToggle(o.slug)}
              aria-pressed={active}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                active
                  ? "border-black bg-black text-white"
                  : "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-500"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
