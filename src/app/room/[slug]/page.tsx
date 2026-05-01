import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import type { Metadata, ResolvingMetadata } from "next";
import type { Locale } from "@/i18n/config";
import SiteHeader from "@/components/SiteHeader";
import Breadcrumb from "@/components/Breadcrumb";
import HScrollRail from "@/components/HScrollRail";
import SectionHeading from "@/components/SectionHeading";
import ItemTypeRailCard from "@/components/ItemTypeRailCard";
import ProductCard from "@/components/ProductCard";
import { loadTaxonomy, labelFor, labelMap, colorHexMap } from "@/lib/taxonomy";
import {
  publishedCountsByItemTypeInRoom,
  listPublishedProducts,
  publishedCountsByRoom,
} from "@/lib/products";

// Intentionally NOT `force-dynamic`. `loadTaxonomy`,
// `publishedCountsByItemTypeInRoom`, and `listPublishedProducts`
// (cookieless under tag-cache) all keep this page bf-cache-eligible.

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata(
  { params }: PageProps,
  parent: ResolvingMetadata,
): Promise<Metadata> {
  const { slug } = await params;
  const [taxonomy, roomCounts, locale, tRoom] = await Promise.all([
    loadTaxonomy(),
    // publishedCountsByRoom is tag-cached on the same `published-counts`
    // tag the page render uses, so this is a free piggyback (cache hit
    // rate ≈ 100% after first warm-up; same revalidate window).
    publishedCountsByRoom(),
    getLocale() as Promise<Locale>,
    getTranslations("room"),
  ]);
  const room = taxonomy.rooms.find((r) => r.slug === slug);
  // Title is just the page noun; the brand suffix is appended by the
  // root layout's `title.template` ('%s · DecoRight'). Returning the
  // brand here too produced "Office · DecoRight · DecoRight" in prod.
  if (!room) return { title: tRoom("notFound") };
  // Per-room OG (Wave SEO commit 2).
  //
  // Image: rooms.cover_url is set for the 6 design-promoted rooms
  // (mig 0020 + scripts/seed-room-covers.ts); the other 11 rooms
  // (legacy quasi-rooms + the recently-promoted office/children/
  // laundry/outdoor/balcony/entrance bunch) keep cover_url = NULL.
  // For those, fall back to the parent's resolved openGraph.images
  // (the file-convention /opengraph-image route from the root). We
  // CANNOT just omit `images` — Next replaces the parent's openGraph
  // wholesale when the child returns its own block, which silently
  // drops the file-convention image (verified locally on /room/curtain).
  //
  // Description: "Browse N products in <Room>" — uses the per-room
  // count from publishedCountsByRoom(). On rooms with zero stock
  // (storefront-internal categories that haven't been populated
  // yet) we drop the count and fall back to a generic line so the
  // share preview doesn't say "Browse 0 products".
  const roomLabel = labelFor(room, locale);
  const count = roomCounts[room.slug] ?? 0;
  const description =
    count > 0
      ? `Browse ${count} ${count === 1 ? "product" : "products"} in ${roomLabel} on DecoRight — see them in 3D, live with AR, buy with confidence.`
      : `Browse ${roomLabel} on DecoRight — every piece shoppable in 3D and AR.`;
  const parentMeta = await parent;
  const parentImages = parentMeta.openGraph?.images ?? [];
  const parentTwitterImages = parentMeta.twitter?.images ?? [];
  const ogImages = room.cover_url
    ? [{ url: room.cover_url, alt: roomLabel }]
    : parentImages;
  const twitterImages = room.cover_url ? [room.cover_url] : parentTwitterImages;
  return {
    title: roomLabel,
    description,
    openGraph: {
      type: "website",
      title: roomLabel,
      description,
      images: ogImages,
    },
    twitter: {
      card: "summary_large_image",
      title: roomLabel,
      description,
      images: twitterImages,
    },
  };
}

/**
 * Layer 2 of the catalog — the room internal page.
 *
 * Wave UI · Commit 4 redesign:
 *
 *   1. Hero — full-width cover image (rooms.cover_url, seeded for the
 *      6 design-promoted rooms) with the room label overlaid on a
 *      bottom gradient. Falls back to a typographic banner when the
 *      room has no cover (legacy quasi-rooms + balcony pending real
 *      photo). Same visual language as RoomCard's cover variant on
 *      the home grid, just at hero scale.
 *
 *   2. Item-type rail — every item_type with at least one published
 *      product in this room, in an HScrollRail. Tap a card → drill
 *      into /item/[slug]?room=this. Sort by taxonomy's label_en order
 *      so the shelf doesn't reshuffle on each publish.
 *
 *   3. Product waterfall — every published product whose `room_slugs`
 *      contains this room, newest first, capped at 60. Same grid
 *      shape as /item/[slug] (2/3/4 columns) so visual rhythm carries
 *      across pages. Products bypass FilterPanel here on purpose:
 *      filters belong on the deepest layer (item-type internal page),
 *      not the room overview where browsers want to scan, not narrow.
 *
 * Why all three on one page rather than three separate routes:
 * mobile users are scrolling, not navigating. Stacking
 * hero → categories → products lets thumb-flicks reach the goods in
 * one go. The previous "tile grid only" forced a second tap into
 * /item/[slug] before any product was visible.
 */
export default async function RoomPage({ params }: PageProps) {
  const { slug } = await params;
  const [taxonomy, counts, products, tHome, tRoom, tSite, locale] =
    await Promise.all([
      loadTaxonomy(),
      // Drives both the rail (filter+count) and the small "N items"
      // labels under each rail card.
      publishedCountsByItemTypeInRoom(slug),
      // Product waterfall — published, scoped to this room. Same
      // listPublishedProducts call shape as /item/[slug] minus the
      // item_type filter; reuses the cookie-aware query path.
      listPublishedProducts({ rooms: [slug] }),
      getTranslations("home"),
      getTranslations("room"),
      getTranslations("site"),
      getLocale() as Promise<Locale>,
    ]);

  const room = taxonomy.rooms.find((r) => r.slug === slug);
  if (!room) notFound();

  // Show every item_type that has at least one published product
  // in this room. Sort by taxonomy order (label_en — set in
  // loadTaxonomy's ORDER BY) so the shelf is stable.
  const itemTypesInRoom = taxonomy.itemTypes.filter(
    (it) => (counts[it.slug] ?? 0) > 0,
  );
  const roomLabel = labelFor(room, locale);

  // Lookup maps for ProductCard. Same shape /item/[slug] feeds it.
  const itemTypeLabels = labelMap(taxonomy.itemTypes, locale);
  const styleLabels = labelMap(taxonomy.styles, locale);
  const colorHex = colorHexMap(taxonomy.colors);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:py-10">
        <Breadcrumb
          items={[
            { label: tSite("home"), href: "/" },
            { label: roomLabel },
          ]}
        />

        {/* ─── Hero · cover-led room banner ───────────────────────
         *
         * Mirrors RoomCard's cover variant (image + bottom-gradient
         * overlay) but at banner aspect ratio so the room reads as
         * the page subject from the first frame. h-48 mobile keeps
         * the rail + first product row above-the-fold on a 375×812
         * viewport; sm:h-64 / lg:h-80 grow proportionally.
         *
         * Fallback (cover_url null): centered typographic block on
         * the same gradient surface RoomCard uses, so the legacy
         * quasi-rooms (Curtain / Decor / Door / …) stay coherent.
         */}
        <section
          className="
            relative mb-8 overflow-hidden rounded-lg
            border border-neutral-200 bg-neutral-50
            sm:mb-10
          "
        >
          {room.cover_url ? (
            <div className="relative h-48 w-full sm:h-64 lg:h-80">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={room.cover_url}
                alt={roomLabel}
                loading="eager"
                fetchPriority="high"
                className="absolute inset-0 h-full w-full object-cover"
              />
              <div
                className="
                  absolute inset-x-0 bottom-0
                  bg-gradient-to-t from-black/70 via-black/30 to-transparent
                  px-5 pb-5 pt-16 sm:px-8 sm:pb-7
                "
              >
                <h1 className="text-2xl font-semibold text-white drop-shadow-sm sm:text-3xl">
                  {roomLabel}
                </h1>
                <p className="mt-1 max-w-xl text-sm text-white/85">
                  {tRoom("pickItemSubtitle", { room: roomLabel })}
                </p>
              </div>
            </div>
          ) : (
            <div
              className="
                flex h-40 flex-col justify-center bg-gradient-to-br
                from-neutral-50 to-neutral-100 px-5 sm:h-56 sm:px-8
              "
            >
              <h1 className="text-2xl font-semibold text-neutral-900 sm:text-3xl">
                {roomLabel}
              </h1>
              <p className="mt-1 max-w-xl text-sm text-neutral-600">
                {tRoom("pickItemSubtitle", { room: roomLabel })}
              </p>
            </div>
          )}
        </section>

        {/* ─── Section · Item types in this room (rail) ───────────
         *
         * Hidden when no item_type has products in this room — that's
         * the "empty room" state below covers it. Showing an empty
         * rail with a heading would feel broken.
         */}
        {itemTypesInRoom.length > 0 ? (
          <section className="mb-8 sm:mb-12">
            <SectionHeading title={tRoom("pickItem")} />
            <HScrollRail ariaLabel={tRoom("pickItem")}>
              {itemTypesInRoom.map((it) => {
                const count = counts[it.slug] ?? 0;
                return (
                  <ItemTypeRailCard
                    key={it.slug}
                    href={`/item/${it.slug}?room=${room.slug}`}
                    label={labelFor(it, locale)}
                    countLabel={tHome("itemCount", { count })}
                  />
                );
              })}
            </HScrollRail>
          </section>
        ) : null}

        {/* ─── Section · All products in this room (waterfall) ─────
         *
         * Same 2/3/4-column grid as /item/[slug] for visual
         * continuity. Capped at 60 by listPublishedProducts default —
         * deeper exploration belongs on /item/[slug] where the user
         * has narrowed by category. Empty state is `room.empty`
         * (existing key) since "no item types" and "no products"
         * collapse to the same outcome from the visitor's POV.
         */}
        <section>
          <SectionHeading title={tRoom("allProducts")} />
          {products.length === 0 ? (
            <div className="flex min-h-[40vh] items-center justify-center rounded-lg border border-dashed border-neutral-300 px-4 text-center text-sm text-neutral-500">
              {tRoom("empty")}
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
      </main>
    </>
  );
}
