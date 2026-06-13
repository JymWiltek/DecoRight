import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/config";
import SiteHeader from "@/components/SiteHeader";
import HScrollRail from "@/components/HScrollRail";
import ItemTypeRailCard from "@/components/ItemTypeRailCard";
import RoomCard from "@/components/RoomCard";
import ProductCard from "@/components/ProductCard";
import SectionHeading from "@/components/SectionHeading";
import {
  listPublishedProducts,
  publishedCountsByItemType,
  publishedCountsByRoom,
  coversByItemType,
  getPublishedBundles,
} from "@/lib/products";
import { loadTaxonomy, labelFor, labelMap, colorHexMap } from "@/lib/taxonomy";
import { buildActiveCategories } from "@/lib/categories";

/**
 * Sprint 1 — full-catalog, designer-focused home.
 *
 *   1. Two FIXED banners (no carousel): "See it in AR, then buy it" +
 *      "every model is a real purchasable product" — the two
 *      differentiators. Side-by-side desktop / stacked mobile, real
 *      product scene photos as the visual (never gray placeholders).
 *   2. Featured Collections (bundles).
 *   3. Browse by Product Type — dynamic chips → /c/{item_type}.
 *   4. Browse by Room → /room/{room}.
 *   5. Latest Additions.
 */
export default async function Home() {
  const [taxonomy, counts, roomCounts, covers, bundles, latest, tHome, tCat, locale] =
    await Promise.all([
      loadTaxonomy(),
      publishedCountsByItemType(),
      publishedCountsByRoom(),
      coversByItemType(),
      getPublishedBundles(3),
      listPublishedProducts({ sort: "latest" }, 24),
      getTranslations("home"),
      getTranslations("category"),
      getLocale() as Promise<Locale>,
    ]);

  const active = buildActiveCategories(
    taxonomy.itemTypes,
    counts,
    covers,
    taxonomy.itemSubtypes,
  );
  const itemTypeLabels = labelMap(taxonomy.itemTypes, locale);
  const styleLabels = labelMap(taxonomy.styles, locale);
  const subtypeLabels = labelMap(taxonomy.itemSubtypes, locale);
  const colorHex = colorHexMap(taxonomy.colors);

  // Banner visuals + CTAs from real products (never gray placeholders).
  const arTarget = latest.find((p) => p.glb_url) ?? latest[0] ?? null;
  const arHref = arTarget ? `/product/${arTarget.id}` : "/search";
  const catalogHref = active[0] ? `/c/${active[0].slug}` : "/search";
  const bannerArBg = arTarget?.thumbnail_url ?? latest[0]?.thumbnail_url ?? null;
  const bannerBuyBg = latest[1]?.thumbnail_url ?? latest[0]?.thumbnail_url ?? null;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:py-8">
        {/* ─── 1. Two fixed banners (no carousel) ───────────────── */}
        <section className="mb-12 grid grid-cols-1 gap-4 md:grid-cols-2">
          <HomeBanner
            bg={bannerArBg}
            title={tHome("bannerArTitle")}
            subtitle={tHome("bannerArSub")}
            ctaLabel={tHome("bannerArCta")}
            href={arHref}
          />
          <HomeBanner
            bg={bannerBuyBg}
            title={tHome("bannerBuyTitle")}
            subtitle={tHome("bannerBuySub")}
            ctaLabel={tHome("bannerBuyCta")}
            href={catalogHref}
          />
        </section>

        {/* ─── 2. Featured Collections (bundles) ────────────────── */}
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

        {/* ─── 3. Browse by Product Type (dynamic chips) ────────── */}
        {active.length > 0 && (
          <section className="mb-12">
            <SectionHeading title={tHome("browseByType")} />
            <HScrollRail ariaLabel={tHome("browseByType")}>
              {active.map((c, i) => (
                <ItemTypeRailCard
                  key={c.slug}
                  href={`/c/${c.slug}`}
                  label={itemTypeLabels[c.slug] ?? c.slug}
                  count={c.count}
                  countLabel={tHome("itemCount", { count: c.count })}
                  coverUrl={c.coverUrl}
                  priority={i < 3}
                />
              ))}
            </HScrollRail>
          </section>
        )}

        {/* ─── 4. Browse by Room ────────────────────────────────── */}
        <section className="mb-12">
          <SectionHeading title={tHome("browseByRoom")} />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {[...taxonomy.rooms]
              .sort((a, b) => a.sort_order - b.sort_order)
              .filter((r) => (roomCounts[r.slug] ?? 0) > 0)
              .map((r) => {
                const count = roomCounts[r.slug] ?? 0;
                return (
                  <RoomCard
                    key={r.slug}
                    href={`/room/${r.slug}`}
                    label={labelFor(r, locale)}
                    count={count}
                    countLabel={tHome("itemCount", { count })}
                    coverUrl={r.cover_url}
                  />
                );
              })}
          </div>
        </section>

        {/* ─── 5. Latest Additions ──────────────────────────────── */}
        {latest.length > 0 && (
          <section>
            <h2 className="mb-4 text-xl font-semibold text-neutral-900">
              {tHome("latestAdditions")}
            </h2>
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
          </section>
        )}
      </main>
    </>
  );
}

/** One of the two fixed home banners. Real product scene photo as the
 *  backdrop with a dark scrim for legible white text — never a gray
 *  placeholder. */
function HomeBanner({
  bg,
  title,
  subtitle,
  ctaLabel,
  href,
}: {
  bg: string | null;
  title: string;
  subtitle: string;
  ctaLabel: string;
  href: string;
}) {
  return (
    <div className="relative min-h-[260px] overflow-hidden rounded-2xl bg-neutral-200">
      {bg && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={bg} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}
      {/* Bottom-up scrim ONLY behind the text — keeps the product image
          clear while text stays legible (no full-image gray wash). */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent" />
      <div className="relative flex h-full flex-col items-start justify-end gap-3 p-6 [text-shadow:0_1px_8px_rgba(0,0,0,0.5)] sm:p-8">
        <h2 className="max-w-md text-2xl font-bold leading-tight text-white sm:text-3xl">
          {title}
        </h2>
        <p className="max-w-md text-sm text-neutral-100">{subtitle}</p>
        <Link
          href={href}
          className="mt-1 inline-flex items-center rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-neutral-900 shadow-lg transition hover:bg-neutral-200 [text-shadow:none]"
        >
          {ctaLabel}
        </Link>
      </div>
    </div>
  );
}
