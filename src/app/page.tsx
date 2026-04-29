import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/config";
import SiteHeader from "@/components/SiteHeader";
import CategoryTile from "@/components/CategoryTile";
import HScrollRail from "@/components/HScrollRail";
import SectionHeading from "@/components/SectionHeading";
import { loadTaxonomy, labelFor } from "@/lib/taxonomy";
import {
  publishedCountsByItemType,
  publishedCountsByRoom,
} from "@/lib/products";

// Intentionally NOT `force-dynamic`. Both `loadTaxonomy` and
// `publishedCountsByItemType` are tag-cached (tags: "taxonomy",
// "published-counts"; revalidate 5 min) on cookieless anon clients,
// so this page can render statically with per-request ISR. Dropping
// force-dynamic re-enables browser bf-cache (was disabled by the
// `cache-control: no-store` force-dynamic emits), which removes
// ~2s off back-button navigations.

/**
 * Layer 1 of the three-layer catalog: choose a room.
 *
 * Was: flat product grid with filters. That design made sense when
 * the catalog was small, but once we have ~200+ SKUs across 11 rooms
 * the funnel "which room am I decorating? → what do I need? → which
 * one?" matches how people actually shop. The old flat page collapsed
 * three decisions into one, which is paralyzing on mobile.
 *
 * Rooms are ordered by `sort_order` (curated in migration 0003). Each
 * tile shows a count of published products currently in that room,
 * summed across its item_types — a zero count signals an empty
 * section but we still render it (the catalog is growing).
 */
export default async function Home() {
  const [taxonomy, roomCounts, itemTypeCounts, tHome, locale] =
    await Promise.all([
      loadTaxonomy(),
      // Migration 0013: room lives on products.room_slugs[] directly —
      // sum per-room counts server-side from that column (a single
      // product in ["kitchen","bathroom"] counts once in each).
      publishedCountsByRoom(),
      // Wave UI · Commit 2: item-type counts feed the new "Browse by
      // item" rail above the room grid. Reuses the same cache tag
      // ("published-counts") so a single publish/unpublish invalidates
      // both lookups in one shot.
      publishedCountsByItemType(),
      getTranslations("home"),
      getLocale() as Promise<Locale>,
    ]);

  // Wave UI · Commit 2 — top item types by published count.
  //
  // Tie-breaker: count DESC, then label_en ASC. Without the alpha
  // secondary sort, two item types with the same count would race
  // every revalidation (taxonomy comes back in a new order whenever
  // a row is touched), so the rail order would jiggle for the
  // operator. label_en is NOT NULL post-migration 0008, so this is
  // safe — and English-canonical sort matches admin muscle memory.
  //
  // Filter: count > 0. Showing "0 items" tiles in the rail wastes
  // valuable above-the-fold mobile space. Empty item types stay
  // discoverable via /room/[slug]/[item_type] (item-internal page).
  //
  // Limit: 8. Notion design specifies 6–8 hot items; eight is the
  // upper end. On a 375px viewport with w-32 cards (~128px) plus
  // 12px gap, eight cards = ~1120px which scrolls smoothly. Tighter
  // limits feel sparse on tablets; wider rails hit visual fatigue.
  const topItemTypes = taxonomy.itemTypes
    .map((it) => ({ ...it, count: itemTypeCounts[it.slug] ?? 0 }))
    .filter((it) => it.count > 0)
    .sort(
      (a, b) =>
        b.count - a.count || a.label_en.localeCompare(b.label_en, "en"),
    )
    .slice(0, 8);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:py-10">
        {/* ─── Section 1 · Browse by item (horizontal rail) ──────
         *
         * Notion design's first viewport block. Item-type tiles in
         * an IKEA-style horizontal-snap rail so a phone user can
         * thumb-swipe through the eight most-stocked categories
         * before they ever scroll vertically.
         *
         * Hidden when nothing is published yet (avoids an empty rail
         * that looks broken; the room grid below still renders since
         * rooms can be browsed independently of catalog depth).
         */}
        {topItemTypes.length > 0 ? (
          <section className="mb-8 sm:mb-12">
            <SectionHeading
              title={tHome("browseByItem")}
              subtitle={tHome("browseByItemSubtitle")}
            />
            <HScrollRail ariaLabel={tHome("browseByItem")}>
              {topItemTypes.map((it) => (
                <li
                  key={it.slug}
                  // Fixed-width card: w-32 mobile (≈128px, fits ~2.7
                  // cards above the fold on iPhone SE), w-36 sm+
                  // (slightly larger labels). snap-start lets the
                  // browser align this card's left edge with the
                  // rail's scroll-padding when the user releases a
                  // swipe — that's the IKEA "thunk" feel.
                  className="w-32 shrink-0 snap-start sm:w-36"
                >
                  <Link
                    href={`/item/${it.slug}`}
                    className="
                      group flex h-full flex-col overflow-hidden
                      rounded-lg border border-neutral-200 bg-white
                      transition active:scale-[0.98]
                      hover:border-black hover:shadow-sm
                    "
                  >
                    <div
                      className="
                        flex aspect-square w-full items-center
                        justify-center bg-gradient-to-br
                        from-neutral-50 to-neutral-100 p-3 text-center
                      "
                    >
                      <span
                        className="
                          text-sm font-semibold leading-tight
                          text-neutral-900
                          transition group-hover:scale-[1.02]
                        "
                      >
                        {labelFor(it, locale)}
                      </span>
                    </div>
                    <div className="px-2.5 py-1.5 text-[11px] text-neutral-500">
                      {tHome("itemCount", { count: it.count })}
                    </div>
                  </Link>
                </li>
              ))}
            </HScrollRail>
          </section>
        ) : null}

        {/* ─── Section 3 · Rooms ──────────────────────────────────
         *
         * Existing room grid. Commit 3 will redesign this with cover
         * photos (Unsplash → own-bucket); kept as-is in commit 2 to
         * keep this commit's diff focused on the new rail.
         */}
        <header className="mb-4 sm:mb-8">
          <h1 className="text-2xl font-semibold text-neutral-900 sm:text-3xl">
            {tHome("pickRoom")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-neutral-600">
            {tHome("pickRoomSubtitle")}
          </p>
        </header>

        {taxonomy.rooms.length === 0 ? (
          <div className="flex min-h-[40vh] items-center justify-center rounded-lg border border-dashed border-neutral-300 px-4 text-center text-sm text-neutral-500">
            {tHome("roomEmpty")}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {taxonomy.rooms.map((r) => {
              const count = roomCounts[r.slug] ?? 0;
              return (
                <CategoryTile
                  key={r.slug}
                  href={`/room/${r.slug}`}
                  label={labelFor(r, locale)}
                  count={count}
                  countLabel={tHome("itemCount", { count })}
                />
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}
