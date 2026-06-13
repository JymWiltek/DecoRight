import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import type { Locale } from "@/i18n/config";
import SiteHeader from "@/components/SiteHeader";
import FilterPanel from "@/components/FilterPanel";
import ProductCard from "@/components/ProductCard";
import Breadcrumb from "@/components/Breadcrumb";
import {
  listPublishedProducts,
  type ProductFilters,
} from "@/lib/products";
import { loadTaxonomy, labelFor, labelMap, colorHexMap } from "@/lib/taxonomy";
import { getCategory, CATEGORIES, type CategorySlug } from "@/lib/categories";

type SearchParams = Record<string, string | string[] | undefined>;
type PageProps = {
  params: Promise<{ slug: string }>;
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

// Pre-render the 7 category slugs; unknown slugs 404 via notFound().
export function generateStaticParams() {
  return CATEGORIES.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const category = getCategory(slug);
  const tCat = await getTranslations("category");
  if (!category) return { title: tCat("notFound") };
  const label = tCat(category.slug as CategorySlug);
  return {
    title: label,
    description: `Browse ${category.labelEn.toLowerCase()} on DecoRight — every model shoppable in 3D, AR, and downloadable as FBX/GLB for designers.`,
  };
}

/**
 * Wave 12 — category-first listing. The 7 bathroom categories
 * (/category/bathtub, /toilet, …) are the primary navigation axis.
 * Each category rolls up one or more `item_type` slugs (see
 * lib/categories.ts), so the product query filters `item_type IN (…)`.
 *
 * Reuses the existing FilterPanel (style / color / material / sort /
 * search — independent, additive) + subtype pills aggregated across the
 * category's item_types. item_type + room filters are hidden: the
 * category already fixes the item_type set, and the bathroom range isn't
 * room-scoped here.
 */
export default async function CategoryPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const sp = await searchParams;

  const category = getCategory(slug);
  if (!category) notFound();

  const [taxonomy, tHome, tCat, tItem, tSite, locale] = await Promise.all([
    loadTaxonomy(),
    getTranslations("home"),
    getTranslations("category"),
    getTranslations("itemType"),
    getTranslations("site"),
    getLocale() as Promise<Locale>,
  ]);

  // Subtypes that belong to ANY of this category's item_types.
  const subtypesForCategory = taxonomy.itemSubtypes.filter((s) =>
    category.itemTypes.includes(s.item_type_slug),
  );
  const subtypeSlug = pickOne(
    sp.subtype,
    subtypesForCategory.map((s) => s.slug),
  );

  const styleSlugs = new Set(taxonomy.styles.map((r) => r.slug));
  const colorSlugs = new Set(taxonomy.colors.map((r) => r.slug));
  const materialSlugs = new Set(taxonomy.materials.map((r) => r.slug));

  const filters: ProductFilters = {
    q: typeof sp.q === "string" ? sp.q : undefined,
    itemTypes: category.itemTypes,
    subtypes: subtypeSlug ? [subtypeSlug] : undefined,
    styles: pickMany(sp.styles, styleSlugs),
    colors: pickMany(sp.colors, colorSlugs),
    materials: pickMany(sp.materials, materialSlugs),
    sort: pickOne(sp.sort, ["latest", "price_asc", "price_desc"]) as
      | "latest"
      | "price_asc"
      | "price_desc"
      | undefined,
  };

  const products = await listPublishedProducts(filters);
  const itemTypeLabels = labelMap(taxonomy.itemTypes, locale);
  const styleLabels = labelMap(taxonomy.styles, locale);
  const colorHex = colorHexMap(taxonomy.colors);
  const categoryLabel = tCat(category.slug as CategorySlug);

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

        {/* Subtype pills — aggregated across the category's item_types.
            Hidden when the category has no subtypes. */}
        {subtypesForCategory.length > 0 ? (
          <div
            className="-mx-4 mb-6 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            role="group"
            aria-label={tItem("subtype")}
          >
            <div className="flex gap-2">
              <Link
                href={`/category/${category.slug}`}
                className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition ${
                  !subtypeSlug
                    ? "border-black bg-black text-white"
                    : "border-neutral-300 bg-white text-neutral-700 hover:border-black"
                }`}
              >
                {tItem("subtypeAll")}
              </Link>
              {subtypesForCategory.map((s) => {
                const active = subtypeSlug === s.slug;
                return (
                  <Link
                    key={s.slug}
                    href={`/category/${category.slug}?subtype=${s.slug}`}
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

        <div className="grid gap-8 md:grid-cols-[240px_1fr]">
          <Suspense>
            <FilterPanel taxonomy={taxonomy} hide={{ itemType: true, room: true }} />
          </Suspense>

          <section>
            {products.length === 0 ? (
              <div className="flex min-h-[40vh] items-center justify-center rounded-lg border border-dashed border-neutral-300 px-4 text-center text-sm text-neutral-500">
                {tCat("empty")}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {products.map((p, i) => (
                  <ProductCard
                    key={p.id}
                    product={p}
                    priority={i < 4}
                    itemTypeLabels={itemTypeLabels}
                    styleLabels={styleLabels}
                    colorHex={colorHex}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
