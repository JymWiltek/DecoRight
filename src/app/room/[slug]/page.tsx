import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/config";
import SiteHeader from "@/components/SiteHeader";
import CategoryTile from "@/components/CategoryTile";
import Breadcrumb from "@/components/Breadcrumb";
import { loadTaxonomy, labelFor } from "@/lib/taxonomy";
import { publishedCountsByItemTypeInRoom } from "@/lib/products";
import { BRAND } from "@config/brand";

// Intentionally NOT `force-dynamic`. `loadTaxonomy` and the
// room-scoped count query are tag-cached on cookieless anon
// clients (5-min revalidate). Next-intl still makes the page
// dynamic (cookie read for locale), but that emits a bf-cache-
// eligible cache-control header rather than the `no-store` that
// `force-dynamic` forces. Net: back-button is instant again.

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const [taxonomy, locale, tRoom] = await Promise.all([
    loadTaxonomy(),
    getLocale() as Promise<Locale>,
    getTranslations("room"),
  ]);
  const room = taxonomy.rooms.find((r) => r.slug === slug);
  if (!room) return { title: `${tRoom("notFound")} · ${BRAND.name}` };
  return { title: `${labelFor(room, locale)} · ${BRAND.name}` };
}

/**
 * Layer 2: pick an item category within a room. Migration 0013
 * made Room × Item Type × Subtype three independent dimensions —
 * the authoritative "what item_types belong in this room" answer
 * is "which item_types have at least one published product whose
 * room_slugs contains this room". Any item_type with zero
 * published products in this room is hidden, even if the
 * item_type_rooms M2M recommends it (M2M is a hint for the
 * Product edit page, not the storefront).
 *
 * 404 if the slug isn't a known room (defends against stale
 * bookmarks or hand-typed URLs). Rooms with zero item_types
 * show an empty state rather than an error — the room exists,
 * we just haven't seeded any products in it yet.
 */
export default async function RoomPage({ params }: PageProps) {
  const { slug } = await params;
  const [taxonomy, counts, tHome, tRoom, tSite, locale] = await Promise.all([
    loadTaxonomy(),
    // Product-count map scoped to THIS room, keyed by item_type.
    // Drives both the item_type filter (zero count → hide) and
    // the count badge on each tile.
    publishedCountsByItemTypeInRoom(slug),
    getTranslations("home"),
    getTranslations("room"),
    getTranslations("site"),
    getLocale() as Promise<Locale>,
  ]);

  const room = taxonomy.rooms.find((r) => r.slug === slug);
  if (!room) notFound();

  // Show every item_type that has at least one published product
  // in this room. Sort by the taxonomy's existing sort_order so
  // the order stays stable across visits (the counts can fluctuate,
  // but the visual shelf doesn't reshuffle on each publish).
  const items = taxonomy.itemTypes.filter((it) => (counts[it.slug] ?? 0) > 0);
  const roomLabel = labelFor(room, locale);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-10">
        <Breadcrumb
          items={[
            { label: tSite("home"), href: "/" },
            { label: roomLabel },
          ]}
        />
        <header className="mb-8">
          <h1 className="text-2xl font-semibold text-neutral-900 sm:text-3xl">
            {roomLabel}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-neutral-600">
            {tRoom("pickItemSubtitle", { room: roomLabel })}
          </p>
        </header>

        {items.length === 0 ? (
          <div className="flex min-h-[40vh] items-center justify-center rounded-lg border border-dashed border-neutral-300 px-4 text-center text-sm text-neutral-500">
            {tRoom("empty")}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((it) => {
              const count = counts[it.slug] ?? 0;
              return (
                <CategoryTile
                  key={it.slug}
                  href={`/item/${it.slug}?room=${room.slug}`}
                  label={labelFor(it, locale)}
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
