import Link from "next/link";
import Image from "next/image";
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
  getPublishedBundlesWithTotal,
} from "@/lib/products";
import { loadTaxonomy, labelFor, labelMap, colorHexMap } from "@/lib/taxonomy";
import { formatMYR } from "@/lib/format";
import { buildActiveCategories } from "@/lib/categories";
import {
  HERO_AR_IMAGE,
  HERO_BUY_IMAGE,
  ITEM_TYPE_COVERS,
} from "@/lib/home-config";
import { isSceneCoverUrl } from "@/lib/scene-cover-url";

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
      getPublishedBundlesWithTotal(3),
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
  // FIXED hero backgrounds (see src/lib/home-config.ts) — no longer follow
  // the latest upload. The AR button still deep-links to a real product.
  const bannerArBg = HERO_AR_IMAGE ?? arTarget?.thumbnail_url ?? null;
  const bannerBuyBg = HERO_BUY_IMAGE ?? latest[1]?.thumbnail_url ?? null;

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
              {bundles.map(({ bundle: b, totalMyr }) => (
                <Link
                  key={b.id}
                  href={`/bundle/${b.slug}`}
                  className="group flex flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white transition hover:border-neutral-400 hover:shadow-sm"
                >
                  <div className="relative aspect-[16/9] w-full overflow-hidden bg-neutral-100">
                    {b.cover_image_url ? (
                      // next/image (PR-D) — bundle cover as a card-sized
                      // AVIF/WebP, lazy below the fold.
                      <Image
                        src={b.cover_image_url}
                        alt={b.name}
                        fill
                        sizes="(min-width: 768px) 33vw, 100vw"
                        className="object-cover transition group-hover:scale-[1.02]"
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
                    {/* Feature 5 — RM 套餐总价 (summed from members), matching
                        the /bundle/[id] detail page. */}
                    <div className="mt-auto pt-1 text-sm font-semibold text-neutral-900">
                      {formatMYR(totalMyr)}
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
                  // Scene-only covers (Jym): use the FIXED per-type cover
                  // only when it's a /scene- image; otherwise fall back to the
                  // dynamic scene cover (c.coverUrl, already scene-only). A
                  // white-bg fixed cover is dropped → neutral tile.
                  coverUrl={
                    isSceneCoverUrl(ITEM_TYPE_COVERS[c.slug])
                      ? ITEM_TYPE_COVERS[c.slug]
                      : c.coverUrl
                  }
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
              // Show a room tile only if it has products AND a cover image —
              // a coverless room (e.g. Outdoor/Balcony) rendered as an empty
              // grey block. No cover ⇒ hidden rather than shown broken.
              .filter((r) => (roomCounts[r.slug] ?? 0) > 0 && r.cover_url)
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
            {/* Masonry — same as the /c listing: natural aspect ratio
                (capped at 2:3), white borders trimmed by /api/card-image,
                max 4 columns. */}
            <div className="columns-2 gap-4 sm:columns-3 lg:columns-4">
              {latest.map((p, i) => (
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
        // next/image (PR-D) — the hero is the home LCP; priority preloads a
        // viewport-sized AVIF/WebP instead of the raw scene PNG.
        <Image
          src={bg}
          alt=""
          fill
          priority
          sizes="(min-width: 640px) 50vw, 100vw"
          className="object-cover"
        />
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
