import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import type { Locale } from "@/i18n/config";
import SiteHeader from "@/components/SiteHeader";
import ProductCard from "@/components/ProductCard";
import Breadcrumb from "@/components/Breadcrumb";
import { listPublishedProducts } from "@/lib/products";
import { loadTaxonomy, labelFor, labelMap, colorHexMap } from "@/lib/taxonomy";
import {
  CATEGORIES,
  categoryForItemType,
  type CategorySlug,
} from "@/lib/categories";
import type { ProductRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const [taxonomy, locale, tStyle] = await Promise.all([
    loadTaxonomy(),
    getLocale() as Promise<Locale>,
    getTranslations("style"),
  ]);
  const row = taxonomy.styles.find((r) => r.slug === slug);
  if (!row) return { title: tStyle("notFound") };
  const label = labelFor(row, locale);
  return {
    title: label,
    description: `Browse ${label} bathroom products on DecoRight — 3D, AR, and FBX/GLB downloads for designers.`,
  };
}

/**
 * Wave 12 — style entry page. Shows every published product carrying a
 * style, grouped by the 7 bathroom categories (lib/categories), each
 * group headed "Category (N)". Products whose item_type isn't one of the
 * 7 fall into a trailing "Other" group so nothing is hidden.
 */
export default async function StylePage({ params }: PageProps) {
  const { slug } = await params;
  const [taxonomy, tSite, tStyle, tCat, locale] = await Promise.all([
    loadTaxonomy(),
    getTranslations("site"),
    getTranslations("style"),
    getTranslations("category"),
    getLocale() as Promise<Locale>,
  ]);

  const styleRow = taxonomy.styles.find((r) => r.slug === slug);
  if (!styleRow) notFound();

  const products = await listPublishedProducts({ styles: [slug] });
  const styleLabel = labelFor(styleRow, locale);

  const itemTypeLabels = labelMap(taxonomy.itemTypes, locale);
  const styleLabels = labelMap(taxonomy.styles, locale);
  const subtypeLabels = labelMap(taxonomy.itemSubtypes, locale);
  const colorHex = colorHexMap(taxonomy.colors);

  // Group by category slug; unmapped item_types → "other".
  const groups = new Map<string, ProductRow[]>();
  for (const p of products) {
    const cat = categoryForItemType(p.item_type);
    const key = cat?.slug ?? "other";
    let arr = groups.get(key);
    if (!arr) {
      arr = [];
      groups.set(key, arr);
    }
    arr.push(p);
  }
  // Render order: the 7 categories first, then "other".
  const orderedKeys: string[] = [...CATEGORIES.map((c) => c.slug), "other"];
  const labelForGroup = (key: string) =>
    key === "other"
      ? (itemTypeLabels.other ?? "Other")
      : tCat(key as CategorySlug);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <Breadcrumb
          items={[{ label: tSite("home"), href: "/" }, { label: styleLabel }]}
        />
        <h1 className="mb-8 text-xl font-semibold text-neutral-900 sm:text-2xl">
          {styleLabel}
        </h1>

        {products.length === 0 ? (
          <div className="flex min-h-[40vh] items-center justify-center rounded-lg border border-dashed border-neutral-300 px-4 text-center text-sm text-neutral-500">
            {tStyle("empty")}
          </div>
        ) : (
          <div className="space-y-12">
            {orderedKeys.map((key) => {
              const items = groups.get(key);
              if (!items || items.length === 0) return null;
              return (
                <section key={key}>
                  <h2 className="mb-4 text-lg font-semibold text-neutral-900">
                    {labelForGroup(key)}{" "}
                    <span className="text-neutral-400">({items.length})</span>
                  </h2>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                    {items.map((p, i) => (
                      <ProductCard
                        key={p.id}
                        product={p}
                        priority={i < 4}
                        itemTypeLabels={itemTypeLabels}
                        styleLabels={styleLabels}
                        subtypeLabels={subtypeLabels}
                        colorHex={colorHex}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}
