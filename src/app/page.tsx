import { getLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/config";
import SiteHeader from "@/components/SiteHeader";
import RoomCard from "@/components/RoomCard";
import HScrollRail from "@/components/HScrollRail";
import ItemTypeRailCard from "@/components/ItemTypeRailCard";
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
                <ItemTypeRailCard
                  key={it.slug}
                  href={`/item/${it.slug}`}
                  label={labelFor(it, locale)}
                  countLabel={tHome("itemCount", { count: it.count })}
                />
              ))}
            </HScrollRail>
          </section>
        ) : null}

        {/* ─── Section 2 · Tagline ───────────────────────────────
         *
         * "See it, buy it" / "看到什么，就买到什么" / "Lihat, terus beli".
         * One short line that sets the value prop before the room
         * grid. Centered, slightly muted; not a hero — the room grid
         * directly below is the actual landing surface. We deliberately
         * do NOT add a CTA here: the rail above and the grid below
         * already give two click paths, a third would dilute.
         */}
        <section className="mb-8 text-center sm:mb-12">
          <p className="mx-auto max-w-md text-base font-medium text-neutral-700 sm:text-lg">
            {tHome("tagline")}
          </p>
        </section>

        {/* ─── Section 3 · Rooms (cover-led grid) ─────────────────
         *
         * Migration 0020 added rooms.cover_url. The 6 Notion-design
         * primary rooms (living/dining/kitchen/bedroom/bathroom/
         * balcony) have Unsplash covers seeded into our own
         * thumbnails bucket via scripts/seed-room-covers.ts. The
         * other 6 legacy rooms keep cover_url = NULL and fall back
         * to the typographic tile inside RoomCard — which means the
         * grid stays coherent even before Jym ships real photographs
         * for the legacy rooms.
         *
         * Mobile: 2 cols. Tablet+: 3 cols. Desktop: 4 cols. The
         * Notion design only specs 6 cards; we still render all 12
         * because the catalog spans them, but the 6 covered ones
         * dominate visually.
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
        )}

        {/* ─── Section 4 · AI Inspiration (placeholder) ──────────
         *
         * Phase 3+. For now: a single static "coming soon" card so
         * users (and Jym, when reviewing the design) see where the
         * AI feature will land without a half-built UI. NO data, NO
         * API call, NO interactivity — just informational.
         *
         * Placed at the bottom of the home page, after the room grid:
         * this is exploratory / future-looking content; users who
         * want to shop have already had the rail (Section 1) and the
         * room grid (Section 3) above. Section 4 is for browsers who
         * scrolled all the way down.
         */}
        <section className="mt-12 sm:mt-16">
          <div
            className="
              rounded-lg border border-dashed border-neutral-300
              bg-gradient-to-br from-violet-50 via-white to-amber-50
              px-5 py-8 text-center sm:px-8 sm:py-12
            "
          >
            <div className="mx-auto inline-flex items-center gap-2 rounded-full bg-violet-100 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-violet-700">
              <span>{tHome("aiBadge")}</span>
            </div>
            <h2 className="mt-3 text-xl font-semibold text-neutral-900 sm:text-2xl">
              {tHome("aiInspirationTitle")}
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-neutral-600">
              {tHome("aiInspirationSubtitle")}
            </p>
          </div>
        </section>
      </main>
    </>
  );
}
