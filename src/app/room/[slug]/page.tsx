import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/config";
import SiteHeader from "@/components/SiteHeader";
import CategoryTile from "@/components/CategoryTile";
import Breadcrumb from "@/components/Breadcrumb";
import { loadTaxonomy, labelFor } from "@/lib/taxonomy";
import { publishedCountsByItemType } from "@/lib/products";
import { BRAND } from "@config/brand";

export const dynamic = "force-dynamic";

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
 * Layer 2: pick an item category within a room. Renders only the
 * item_types whose `room_slug` matches — so /room/kitchen shows sink,
 * faucet, range hood, etc.; /room/bedroom shows bed_frame, mattress,
 * wardrobe.
 *
 * 404 if the slug isn't a known room (defends against stale bookmarks
 * or hand-typed URLs). Rooms with zero item_types show an empty state
 * rather than an error — the room exists, we just haven't seeded it.
 */
export default async function RoomPage({ params }: PageProps) {
  const { slug } = await params;
  const [taxonomy, counts, tHome, tRoom, tSite, locale] = await Promise.all([
    loadTaxonomy(),
    publishedCountsByItemType(),
    getTranslations("home"),
    getTranslations("room"),
    getTranslations("site"),
    getLocale() as Promise<Locale>,
  ]);

  const room = taxonomy.rooms.find((r) => r.slug === slug);
  if (!room) notFound();

  const items = taxonomy.itemTypes.filter((it) => it.room_slug === slug);
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
                  href={`/item/${it.slug}`}
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
