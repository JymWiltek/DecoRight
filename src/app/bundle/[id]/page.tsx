import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import type { Locale } from "@/i18n/config";
import SiteHeader from "@/components/SiteHeader";
import ProductCard from "@/components/ProductCard";
import Breadcrumb from "@/components/Breadcrumb";
import { getPublishedBundle } from "@/lib/products";
import { loadTaxonomy, labelMap, colorHexMap } from "@/lib/taxonomy";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const data = await getPublishedBundle(id);
  if (!data) {
    const t = await getTranslations("bundle");
    return { title: t("notFound") };
  }
  return {
    title: data.bundle.name,
    description:
      data.bundle.description ??
      `${data.bundle.name} — a curated bathroom set on DecoRight. Download the full FBX bundle for designers.`,
  };
}

/**
 * Wave 12 — bundle detail page. Reuses the Wave 10 bundles /
 * bundle_products tables (getPublishedBundle). Shows the hero cover,
 * the "save %" vs the sum of member products' credit cost, a Download
 * Bundle FBX CTA, and the included products as 3:4 cards.
 *
 * The bundle FBX zip itself isn't generated yet (no paywall / no
 * bundle-zip endpoint this wave), so the download CTA is rendered
 * disabled ("coming soon") rather than linking to a missing artifact.
 */
export default async function BundlePage({ params }: PageProps) {
  const { id } = await params;
  const [data, taxonomy, tBundle, tSite, locale] = await Promise.all([
    getPublishedBundle(id),
    loadTaxonomy(),
    getTranslations("bundle"),
    getTranslations("site"),
    getLocale() as Promise<Locale>,
  ]);
  if (!data) notFound();
  const { bundle, products } = data;

  const itemTypeLabels = labelMap(taxonomy.itemTypes, locale);
  const styleLabels = labelMap(taxonomy.styles, locale);
  const subtypeLabels = labelMap(taxonomy.itemSubtypes, locale);
  const colorHex = colorHexMap(taxonomy.colors);

  // "Save X%" — bundle credit_cost vs the sum of member credit costs.
  const originalCredit = products.reduce(
    (sum, p) => sum + (p.download_credit_cost ?? 0),
    0,
  );
  const savePct =
    originalCredit > bundle.credit_cost && originalCredit > 0
      ? Math.round(((originalCredit - bundle.credit_cost) / originalCredit) * 100)
      : 0;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Breadcrumb
          items={[{ label: tSite("home"), href: "/" }, { label: bundle.name }]}
        />

        {/* Hero */}
        <section className="overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50">
          <div className="relative aspect-[21/9] w-full bg-neutral-100">
            {bundle.cover_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={bundle.cover_image_url}
                alt={bundle.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-neutral-100 to-neutral-200 text-sm text-neutral-400">
                {bundle.name}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-end justify-between gap-4 p-6">
            <div>
              <h1 className="text-2xl font-semibold text-neutral-900">
                {bundle.name}
              </h1>
              <p className="mt-1 text-sm text-neutral-500">
                {tBundle("pieces", { count: products.length })}
              </p>
              {bundle.description && (
                <p className="mt-3 max-w-2xl text-sm leading-relaxed text-neutral-700">
                  {bundle.description}
                </p>
              )}
            </div>
            <div className="text-right">
              <div className="flex items-baseline justify-end gap-2">
                {savePct > 0 && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                    {tBundle("save", { pct: savePct })}
                  </span>
                )}
                <span className="text-2xl font-bold text-neutral-900">
                  {tBundle("credit", { credit: bundle.credit_cost })}
                </span>
              </div>
              {savePct > 0 && (
                <div className="mt-0.5 text-xs text-neutral-400 line-through">
                  {tBundle("was", { credit: originalCredit })}
                </div>
              )}
              <button
                type="button"
                disabled
                title={tBundle("downloadSoon")}
                className="mt-3 inline-flex cursor-not-allowed items-center justify-center rounded-md bg-neutral-200 px-5 py-2.5 text-sm font-medium text-neutral-500"
              >
                {tBundle("download")}
              </button>
            </div>
          </div>
        </section>

        {/* Included products */}
        <section className="mt-10">
          <h2 className="mb-4 text-lg font-semibold text-neutral-900">
            {tBundle("includes")}
          </h2>
          {products.length === 0 ? (
            <div className="flex min-h-[20vh] items-center justify-center rounded-lg border border-dashed border-neutral-300 px-4 text-center text-sm text-neutral-500">
              {tBundle("empty")}
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
                  subtypeLabels={subtypeLabels}
                  colorHex={colorHex}
                />
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
