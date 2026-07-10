import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import type { Locale } from "@/i18n/config";
import SiteHeader from "@/components/SiteHeader";
import TopFilters from "@/components/TopFilters";
import ProductCard from "@/components/ProductCard";
import Breadcrumb from "@/components/Breadcrumb";
import {
  listPublishedProducts,
  getCategoryFacets,
  type ProductFilters,
} from "@/lib/products";
import { loadTaxonomy, labelFor, labelMap, colorHexMap } from "@/lib/taxonomy";

type SearchParams = Record<string, string | string[] | undefined>;
type PageProps = {
  params: Promise<{ category: string }>;
  searchParams: Promise<SearchParams>;
};

function pickOne(
  v: string | string[] | undefined,
  allowed: readonly string[],
): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  if (!s) return undefined;
  return allowed.includes(s) ? s : undefined;
}

function pickMany(v: string | string[] | undefined, allowed: Set<string>): string[] {
  const raw = Array.isArray(v) ? v.join(",") : v ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && allowed.has(s));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { category } = await params;
  const [taxonomy, locale, tItem] = await Promise.all([
    loadTaxonomy(),
    getLocale() as Promise<Locale>,
    getTranslations("itemType"),
  ]);
  const row = taxonomy.itemTypes.find((r) => r.slug === category);
  if (!row) return { title: tItem("notFound") };
  const label = labelFor(row, locale);
  return {
    title: label,
    description: `Browse ${label.toLowerCase()} on DecoRight — every model shoppable in 3D, AR, and downloadable as FBX/GLB for designers.`,
  };
}

/**
 * Sprint 1 — full-catalog category page. "Category = item_type": the
 * route param IS the item_type slug (e.g. /c/bathtub, /c/toilet,
 * /c/sofa). Replaces Wave 12's 7-bathroom-rollup /category/[slug]
 * (which now 301-redirects here via next.config). Reuses FilterPanel
 * (style/color/material/sort/search — independent + additive) + subtype
 * pills. item_type + room filters are hidden (the category fixes the
 * item_type; the full catalog isn't room-scoped here).
 */
export default async function CategoryPage({ params, searchParams }: PageProps) {
  const { category } = await params;
  const sp = await searchParams;

  const [taxonomy, tHome, tItem, tSite, locale] = await Promise.all([
    loadTaxonomy(),
    getTranslations("home"),
    getTranslations("itemType"),
    getTranslations("site"),
    getLocale() as Promise<Locale>,
  ]);

  const itemType = taxonomy.itemTypes.find((r) => r.slug === category);
  if (!itemType) notFound();

  const subtypesForItemType = taxonomy.itemSubtypes.filter(
    (s) => s.item_type_slug === itemType.slug,
  );
  const subtypeSlug = pickOne(
    sp.subtype,
    subtypesForItemType.map((s) => s.slug),
  );

  // Per-category, in-stock filter options — the iron rule: a Style/Color
  // option shows ONLY if this category (+ subtype, if picked) actually has a
  // product with it. Computed live from the DB, recomputed per category.
  const facets = await getCategoryFacets(itemType.slug, subtypeSlug);
  const styleSet = new Set(facets.styles);
  const colorSet = new Set(facets.colors);
  const styleOptions = taxonomy.styles
    .filter((r) => styleSet.has(r.slug))
    .map((r) => ({ slug: r.slug, label: labelFor(r, locale) }));
  const colorOptions = taxonomy.colors
    .filter((r) => colorSet.has(r.slug))
    .map((r) => ({ slug: r.slug, label: labelFor(r, locale), hex: r.hex }));

  const filters: ProductFilters = {
    q: typeof sp.q === "string" ? sp.q : undefined,
    itemTypes: [itemType.slug],
    subtypes: subtypeSlug ? [subtypeSlug] : undefined,
    // Only accept a style/color URL value that is actually in this category.
    styles: pickMany(sp.styles, styleSet),
    colors: pickMany(sp.colors, colorSet),
    sort: pickOne(sp.sort, ["latest", "price_asc", "price_desc"]) as
      | "latest"
      | "price_asc"
      | "price_desc"
      | undefined,
  };

  const products = await listPublishedProducts(filters);
  const itemTypeLabels = labelMap(taxonomy.itemTypes, locale);
  const styleLabels = labelMap(taxonomy.styles, locale);
  const subtypeLabels = labelMap(taxonomy.itemSubtypes, locale);
  const colorHex = colorHexMap(taxonomy.colors);
  const categoryLabel = labelFor(itemType, locale);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <Breadcrumb
          items={[{ label: tSite("home"), href: "/" }, { label: categoryLabel }]}
        />

        <div className="mb-6 flex flex-wrap items-end justify-between gap-2">
          <h1 className="text-xl font-semibold text-neutral-900 sm:text-2xl">
            {categoryLabel}
          </h1>
          <div className="text-xs text-neutral-500">
            {tHome("itemCount", { count: products.length })}
          </div>
        </div>

        {subtypesForItemType.length > 0 ? (
          <div
            className="-mx-4 mb-6 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            role="group"
            aria-label={tItem("subtype")}
          >
            <div className="flex gap-2">
              <Link
                href={`/c/${itemType.slug}`}
                className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition ${
                  !subtypeSlug
                    ? "border-black bg-black text-white"
                    : "border-neutral-300 bg-white text-neutral-700 hover:border-black"
                }`}
              >
                {tItem("subtypeAll")}
              </Link>
              {subtypesForItemType.map((s) => {
                const active = subtypeSlug === s.slug;
                return (
                  <Link
                    key={s.slug}
                    href={`/c/${itemType.slug}?subtype=${s.slug}`}
                    className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition ${
                      active
                        ? "border-black bg-black text-white"
                        : "border-neutral-300 bg-white text-neutral-700 hover:border-black"
                    }`}
                  >
                    {labelFor(s, locale)}
                  </Link>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Top pill filters (replaced the left sidebar) — list area now
            spans full width below them. */}
        <Suspense>
          <TopFilters styleOptions={styleOptions} colorOptions={colorOptions} />
        </Suspense>

        <section>
          {products.length === 0 ? (
            <div className="flex min-h-[40vh] items-center justify-center rounded-lg border border-dashed border-neutral-300 px-4 text-center text-sm text-neutral-500">
              {tItem("empty")}
            </div>
          ) : (
            // Masonry: CSS columns + break-inside-avoid cards. Each image
            // flows at its natural aspect ratio (no 3:4 crop, but capped at
            // 2:3 by ProductCard) — horizontals stay wide, verticals tall,
            // white borders trimmed by the card route. column-gap via `gap`;
            // row spacing via the card's mb. Max 4 columns (mobile 2 /
            // tablet 3 / desktop 4) — wider gives bigger, legible cards.
            <div className="columns-2 gap-4 sm:columns-3 lg:columns-4">
              {products.map((p, i) => (
                <div key={p.id} className="mb-4 break-inside-avoid">
                  <ProductCard
                    product={p}
                    masonry
                    priority={i < 4}
                    itemTypeLabels={itemTypeLabels}
                    styleLabels={styleLabels}
                    subtypeLabels={subtypeLabels}
                    colorHex={colorHex}
                  />
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
