import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/config";
import SiteHeader from "@/components/SiteHeader";
import ItemTypeCoverCard from "@/components/ItemTypeCoverCard";
import ProductCard from "@/components/ProductCard";
import {
  listPublishedProducts,
  publishedCountsByItemType,
  coversByItemType,
  getPublishedBundles,
} from "@/lib/products";
import { loadTaxonomy, labelMap, colorHexMap } from "@/lib/taxonomy";
import { CATEGORIES, type CategorySlug } from "@/lib/categories";

/**
 * Wave 12 — designer-focused home. Replaces the room-first funnel
 * (browse-by-item rail + room grid) with the layout designers expect
 * from 3D66 / Coohom:
 *
 *   1. Hero — scene image + "Bathroom 3D Models for Designers" + stats.
 *   2. Featured Bundles — newest published bundles (hidden when none).
 *   3. Browse by Category — the 7 bathroom categories as cover cards.
 *   4. Latest Additions — the 24 newest published products.
 *
 * Room pages (/room/[slug]) still exist and are reachable; they're just
 * no longer the landing surface. Reads `listPublishedProducts` (cookie-
 * aware) so the page renders dynamically with fresh latest/bundle data.
 */
export default async function Home() {
  const [taxonomy, itemTypeCounts, itemTypeCovers, bundles, latest, tHome, tCat, locale] =
    await Promise.all([
      loadTaxonomy(),
      publishedCountsByItemType(),
      coversByItemType(),
      getPublishedBundles(3),
      listPublishedProducts({ sort: "latest" }, 24),
      getTranslations("home"),
      getTranslations("category"),
      getLocale() as Promise<Locale>,
    ]);

  const itemTypeLabels = labelMap(taxonomy.itemTypes, locale);
  const styleLabels = labelMap(taxonomy.styles, locale);
  const subtypeLabels = labelMap(taxonomy.itemSubtypes, locale);
  const colorHex = colorHexMap(taxonomy.colors);

  const totalModels = Object.values(itemTypeCounts).reduce((a, b) => a + b, 0);
  const heroBg = latest[0]?.thumbnail_url ?? null;

  // 7 category cards: count = sum of member item_type counts; cover =
  // first member item_type that has a cover thumbnail.
  const categoryCards = CATEGORIES.map((c) => ({
    slug: c.slug,
    label: tCat(c.slug as CategorySlug),
    count: c.itemTypes.reduce((sum, it) => sum + (itemTypeCounts[it] ?? 0), 0),
    coverUrl: c.itemTypes.map((it) => itemTypeCovers[it]).find(Boolean) ?? null,
  }));

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:py-8">
        {/* ─── 1. Hero ──────────────────────────────────────────── */}
        <section className="relative mb-12 overflow-hidden rounded-2xl bg-neutral-900">
          {heroBg && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={heroBg}
              alt=""
              className="absolute inset-0 h-full w-full object-cover opacity-40"
            />
          )}
          <div className="relative flex flex-col items-start gap-4 px-6 py-16 sm:px-12 sm:py-24">
            <h1 className="max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-5xl">
              {tHome("heroTitle")}
            </h1>
            <p className="max-w-xl text-sm text-neutral-200 sm:text-base">
              {tHome("heroSubtitle")}
            </p>
            <span className="mt-2 inline-flex items-center rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white backdrop-blur">
              {tHome("heroStat", { count: totalModels })}
            </span>
          </div>
        </section>

        {/* ─── 2. Featured Bundles (hidden when none) ───────────── */}
        {bundles.length > 0 && (
          <section className="mb-12">
            <h2 className="mb-4 text-xl font-semibold text-neutral-900">
              {tHome("featuredBundles")}
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {bundles.map((b) => (
                <Link
                  key={b.id}
                  href={`/bundle/${b.slug}`}
                  className="group flex flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white transition hover:border-neutral-400 hover:shadow-sm"
                >
                  <div className="relative aspect-[16/9] w-full overflow-hidden bg-neutral-100">
                    {b.cover_image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={b.cover_image_url}
                        alt={b.name}
                        className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-sm text-neutral-400">
                        {b.name}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col gap-1 p-3">
                    <div className="line-clamp-1 text-sm font-medium text-neutral-900">
                      {b.name}
                    </div>
                    <div className="mt-auto pt-1 text-sm font-semibold text-neutral-900">
                      {b.credit_cost} credit
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* ─── 3. Browse by Category (7 cards) ──────────────────── */}
        <section className="mb-12">
          <h2 className="mb-4 text-xl font-semibold text-neutral-900">
            {tHome("browseByCategory")}
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
            {categoryCards.map((c, i) => (
              <ItemTypeCoverCard
                key={c.slug}
                href={`/category/${c.slug}`}
                label={c.label}
                count={c.count}
                countLabel={tHome("itemCount", { count: c.count })}
                coverUrl={c.coverUrl}
                priority={i < 4}
              />
            ))}
          </div>
        </section>

        {/* ─── 4. Latest Additions (24) ─────────────────────────── */}
        <section>
          <h2 className="mb-4 text-xl font-semibold text-neutral-900">
            {tHome("latestAdditions")}
          </h2>
          {latest.length === 0 ? (
            <div className="flex min-h-[30vh] items-center justify-center rounded-lg border border-dashed border-neutral-300 px-4 text-center text-sm text-neutral-500">
              {tHome("roomEmpty")}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {latest.map((p, i) => (
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
