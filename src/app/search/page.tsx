import { getLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import type { Locale } from "@/i18n/config";
import SiteHeader from "@/components/SiteHeader";
import ProductCard from "@/components/ProductCard";
import Breadcrumb from "@/components/Breadcrumb";
import { listPublishedProducts } from "@/lib/products";
import { loadTaxonomy, labelMap, colorHexMap } from "@/lib/taxonomy";

type PageProps = {
  searchParams: Promise<{ q?: string | string[] }>;
};

export const metadata: Metadata = { title: "Search" };

/**
 * Wave 12 — global product search. The site-header search box GETs here
 * with `?q=`. Runs the same name/brand/description match the listing
 * pages use (listPublishedProducts({ q })) across the whole published
 * catalog and renders the standard ProductCard grid.
 */
export default async function SearchPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q ?? "").trim();

  const [taxonomy, tHome, tCat, tSite, locale] = await Promise.all([
    loadTaxonomy(),
    getTranslations("home"),
    getTranslations("category"),
    getTranslations("site"),
    getLocale() as Promise<Locale>,
  ]);

  const products = q ? await listPublishedProducts({ q }) : [];
  const itemTypeLabels = labelMap(taxonomy.itemTypes, locale);
  const styleLabels = labelMap(taxonomy.styles, locale);
  const colorHex = colorHexMap(taxonomy.colors);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <Breadcrumb
          items={[{ label: tSite("home"), href: "/" }, { label: tCat("search") }]}
        />

        <div className="mb-6 flex flex-wrap items-end justify-between gap-2">
          <h1 className="text-xl font-semibold text-neutral-900 sm:text-2xl">
            {tCat("search")}
            {q ? <span className="text-neutral-400">: “{q}”</span> : null}
          </h1>
          {q ? (
            <div className="text-xs text-neutral-500">
              {tHome("itemCount", { count: products.length })}
            </div>
          ) : null}
        </div>

        {!q ? (
          <div className="flex min-h-[30vh] items-center justify-center rounded-lg border border-dashed border-neutral-300 px-4 text-center text-sm text-neutral-500">
            {tCat("searchPlaceholder")}
          </div>
        ) : products.length === 0 ? (
          <div className="flex min-h-[30vh] items-center justify-center rounded-lg border border-dashed border-neutral-300 px-4 text-center text-sm text-neutral-500">
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
      </main>
    </>
  );
}
