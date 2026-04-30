import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/config";
import SiteHeader from "@/components/SiteHeader";
import FilterPanel from "@/components/FilterPanel";
import ProductCard from "@/components/ProductCard";
import Breadcrumb from "@/components/Breadcrumb";
import HScrollRail from "@/components/HScrollRail";
import SectionHeading from "@/components/SectionHeading";
import ItemTypeRailCard from "@/components/ItemTypeRailCard";
import { listPublishedProducts, type ProductFilters } from "@/lib/products";
import { publishedCountsByItemTypeInRoom } from "@/lib/products";
import { loadTaxonomy, labelFor, labelMap, colorHexMap } from "@/lib/taxonomy";

// `searchParams` + cookie-aware product query already make this page
// dynamic. Explicit `force-dynamic` only adds `cache-control: no-store`
// on the response, which disables browser bf-cache. Dropping it lets
// the back button restore the filtered grid instantly.

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

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const [taxonomy, locale, tItem] = await Promise.all([
    loadTaxonomy(),
    getLocale() as Promise<Locale>,
    getTranslations("itemType"),
  ]);
  const it = taxonomy.itemTypes.find((r) => r.slug === slug);
  // Title is just the page noun; the brand suffix is appended by the
  // root layout's `title.template` ('%s · DecoRight'). Returning the
  // brand here too produced "Mirror · DecoRight · DecoRight" in prod.
  if (!it) return { title: tItem("notFound") };
  return { title: labelFor(it, locale) };
}

/**
 * Layer 3 of the catalog — the item-type internal page.
 *
 * Existing behavior (kept):
 *   • style / color / material / price / sort filters via FilterPanel.
 *   • item_type fixed by URL; ?room= scopes the product query so
 *     /item/faucet?room=kitchen hides bathroom faucets.
 *
 * Wave UI · Commit 5 additions:
 *
 *   1. Subtype pills — when the item_type owns subtypes (Faucet →
 *      pull-out / sensor / wall-mounted / …), render a horizontal
 *      pill row above the product grid. Each pill flips
 *      `?subtype=<slug>`. "All" clears the subtype filter. Hidden
 *      entirely when the item_type has zero subtypes — adding a
 *      single-pill row would be visual noise.
 *
 *   2. Sibling rail — when ?room= is present and the same room has
 *      OTHER item_types with published products, show those siblings
 *      in an HScrollRail labelled "Also in {room}". Drives the
 *      "browsing the kitchen, just bought a faucet, also need a
 *      sink" cross-sell without forcing the visitor back to
 *      /room/[slug]. Excludes the current item_type — the user is
 *      already on it. Hidden when no ?room= or no siblings (the
 *      visitor came in via /item/[slug] without room context, or the
 *      room only has this one item_type with stock).
 *
 * Both new UI pieces sit ABOVE FilterPanel because they're navigation
 * (jump elsewhere) or coarse filtering (subtype). The fine filters
 * (style/color/material) stay in FilterPanel where they belong.
 */
export default async function ItemTypePage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const sp = await searchParams;

  const [taxonomy, tHome, tItem, tSite, locale] = await Promise.all([
    loadTaxonomy(),
    getTranslations("home"),
    getTranslations("itemType"),
    getTranslations("site"),
    getLocale() as Promise<Locale>,
  ]);

  const itemType = taxonomy.itemTypes.find((r) => r.slug === slug);
  if (!itemType) notFound();

  // Migration 0013: item_type no longer owns a single room. The
  // breadcrumb "Kitchen / Faucet" only makes sense if the visitor
  // came from a specific room page — we look at `?room=<slug>`
  // which /room/[slug] now appends to its outgoing links. Missing
  // or unknown ?room = no middle crumb (just "Home / Faucet").
  const roomSlugParam = pickOne(
    sp.room,
    taxonomy.rooms.map((r) => r.slug),
  );
  const room = roomSlugParam
    ? taxonomy.rooms.find((r) => r.slug === roomSlugParam) ?? null
    : null;

  // Subtype filter (Wave UI · Commit 5). Subtypes belong to a single
  // item_type via item_type_slug — clamp the URL pick to subtypes
  // that actually live under the current item_type. A stray
  // ?subtype=xxx that doesn't belong here is silently ignored
  // (defends against hand-typed URLs and old links after a subtype
  // gets renamed).
  const subtypesForItemType = taxonomy.itemSubtypes.filter(
    (s) => s.item_type_slug === itemType.slug,
  );
  const subtypeSlug = pickOne(
    sp.subtype,
    subtypesForItemType.map((s) => s.slug),
  );

  const styleSlugs = new Set(taxonomy.styles.map((r) => r.slug));
  const colorSlugs = new Set(taxonomy.colors.map((r) => r.slug));
  const materialSlugs = new Set(taxonomy.materials.map((r) => r.slug));

  // item_type is fixed by route — ignore any stray ?item_types= in
  // the querystring to prevent the URL from disagreeing with the
  // page title. If we came in via /room/X, scope products to that
  // room too (so visiting /item/faucet?room=kitchen hides bathroom
  // faucets without the user picking a room filter explicitly).
  const filters: ProductFilters = {
    q: typeof sp.q === "string" ? sp.q : undefined,
    itemTypes: [itemType.slug],
    rooms: room ? [room.slug] : undefined,
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

  // Sibling rail data — only fetched when ?room= is meaningful.
  // publishedCountsByItemTypeInRoom is tag-cached per-room so this
  // is a no-extra-cost call when the room page already warmed it.
  const siblingCounts = room
    ? await publishedCountsByItemTypeInRoom(room.slug)
    : {};
  const siblingItemTypes = room
    ? taxonomy.itemTypes
        .filter((it) => it.slug !== itemType.slug)
        .filter((it) => (siblingCounts[it.slug] ?? 0) > 0)
    : [];

  const products = await listPublishedProducts(filters);
  const itemTypeLabels = labelMap(taxonomy.itemTypes, locale);
  const styleLabels = labelMap(taxonomy.styles, locale);
  const colorHex = colorHexMap(taxonomy.colors);

  const itemTypeLabel = labelFor(itemType, locale);
  const roomLabel = room ? labelFor(room, locale) : null;

  // Helper: build a `?room=…` query string preserving room context
  // for outgoing links from the sibling rail. Subtype pills strip
  // ?subtype but preserve ?room.
  const roomQS = room ? `?room=${room.slug}` : "";

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <Breadcrumb
          items={[
            { label: tSite("home"), href: "/" },
            ...(room && roomLabel
              ? [{ label: roomLabel, href: `/room/${room.slug}` }]
              : []),
            { label: itemTypeLabel },
          ]}
        />

        <div className="mb-6 flex flex-wrap items-end justify-between gap-2">
          <h1 className="text-xl font-semibold text-neutral-900 sm:text-2xl">
            {itemTypeLabel}
          </h1>
          <div className="text-xs text-neutral-500">
            {tHome("itemCount", { count: products.length })}
          </div>
        </div>

        {/* ─── Sibling rail · Also in {room} ──────────────────────
         *
         * Cross-sell into other item_types in the same room. Only
         * renders when ?room= is present AND there's at least one
         * other stocked item_type in that room. On a /item/faucet
         * (no room) hit this is hidden — there's no contextual room
         * to anchor the rail to.
         */}
        {room && roomLabel && siblingItemTypes.length > 0 ? (
          <section className="mb-8 sm:mb-10">
            <SectionHeading title={tItem("alsoIn", { room: roomLabel })} />
            <HScrollRail ariaLabel={tItem("alsoIn", { room: roomLabel })}>
              {siblingItemTypes.map((it) => {
                const count = siblingCounts[it.slug] ?? 0;
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

        {/* ─── Subtype pills · narrow within this item_type ───────
         *
         * Hidden when the item_type has no subtypes. When it does,
         * an "All" pill is always present so the visitor can clear a
         * subtype pick without retyping the URL. Active pill flips
         * to filled-dark; inactive stays bordered. Horizontal-scroll
         * for long subtype lists — on a 375px viewport with 7+
         * subtypes the row would otherwise wrap into 2-3 untidy
         * lines. Same overflow trick as HScrollRail (`-mx-4` +
         * scrollbar hiding) so the row reaches edge-to-edge.
         */}
        {subtypesForItemType.length > 0 ? (
          <div
            className="
              -mx-4 mb-6 overflow-x-auto px-4 pb-1
              [scrollbar-width:none]
              [&::-webkit-scrollbar]:hidden
            "
            role="group"
            aria-label={tItem("subtype")}
          >
            <div className="flex gap-2">
              <Link
                href={`/item/${itemType.slug}${roomQS}`}
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
                // Each subtype pill writes ?subtype=<slug> while
                // preserving ?room=. We rebuild the full querystring
                // rather than using URLSearchParams because the page
                // is a Server Component — sp arrived as a plain
                // object and we only ever care about two keys here
                // (room, subtype). Other params (styles/colors/etc.)
                // get reset on subtype change, which is intentional:
                // changing the rough cut should reset the fine cuts.
                const qs = new URLSearchParams();
                if (room) qs.set("room", room.slug);
                qs.set("subtype", s.slug);
                return (
                  <Link
                    key={s.slug}
                    href={`/item/${itemType.slug}?${qs.toString()}`}
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
            <FilterPanel
              taxonomy={taxonomy}
              hide={{ itemType: true, room: true }}
            />
          </Suspense>

          <section>
            {products.length === 0 ? (
              <div className="flex min-h-[40vh] items-center justify-center rounded-lg border border-dashed border-neutral-300 px-4 text-center text-sm text-neutral-500">
                {tItem("empty")}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {products.map((p, i) => (
                  // First 4 cards are above-the-fold on desktop (lg:4-col)
                  // and partially above the fold on mobile (2-col × ~2 rows).
                  // Marking them priority lets the preload scanner surface
                  // the LCP image before JS hydration — fixes the
                  // lcp-discovery-insight warning on /item/<slug>.
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
