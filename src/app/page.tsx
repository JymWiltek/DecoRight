import { getLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/config";
import SiteHeader from "@/components/SiteHeader";
import CategoryTile from "@/components/CategoryTile";
import { loadTaxonomy, labelFor } from "@/lib/taxonomy";
import { publishedCountsByItemType } from "@/lib/products";

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
  const [taxonomy, counts, tHome, locale] = await Promise.all([
    loadTaxonomy(),
    publishedCountsByItemType(),
    getTranslations("home"),
    getLocale() as Promise<Locale>,
  ]);

  // Sum product counts per room via item_types.room_slug.
  const roomCounts: Record<string, number> = {};
  for (const it of taxonomy.itemTypes) {
    if (!it.room_slug) continue;
    roomCounts[it.room_slug] =
      (roomCounts[it.room_slug] ?? 0) + (counts[it.slug] ?? 0);
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-10">
        <header className="mb-8">
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
