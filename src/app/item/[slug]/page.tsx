import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/config";
import SiteHeader from "@/components/SiteHeader";
import FilterPanel from "@/components/FilterPanel";
import ProductCard from "@/components/ProductCard";
import Breadcrumb from "@/components/Breadcrumb";
import { listPublishedProducts, type ProductFilters } from "@/lib/products";
import { loadTaxonomy, labelFor, labelMap, colorHexMap } from "@/lib/taxonomy";
import { BRAND } from "@config/brand";

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
  if (!it) return { title: `${tItem("notFound")} · ${BRAND.name}` };
  return { title: `${labelFor(it, locale)} · ${BRAND.name}` };
}

/**
 * Layer 3: the actual product list, scoped to a single item_type.
 * Style / color / material / price / sort remain available via
 * FilterPanel because those cut across item_types — a "red oak dining
 * chair" and "red oak sofa" answer different shopping questions, but
 * within dining chairs the user still wants to narrow by color.
 *
 * The item_type and its parent room are fixed by the URL, so the
 * filter panel hides those groups — clicking "another room" means
 * navigating back up, not restyling the URL with conflicting picks.
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

  const room = itemType.room_slug
    ? taxonomy.rooms.find((r) => r.slug === itemType.room_slug)
    : null;

  const styleSlugs = new Set(taxonomy.styles.map((r) => r.slug));
  const colorSlugs = new Set(taxonomy.colors.map((r) => r.slug));
  const materialSlugs = new Set(taxonomy.materials.map((r) => r.slug));

  // item_type is fixed by route — ignore any stray ?item_types= in
  // the querystring to prevent the URL from disagreeing with the
  // page title.
  const filters: ProductFilters = {
    q: typeof sp.q === "string" ? sp.q : undefined,
    itemTypes: [itemType.slug],
    styles: pickMany(sp.styles, styleSlugs),
    colors: pickMany(sp.colors, colorSlugs),
    materials: pickMany(sp.materials, materialSlugs),
    sort: pickOne(sp.sort, ["latest", "price_asc", "price_desc"]) as
      | "latest"
      | "price_asc"
      | "price_desc"
      | undefined,
  };

  const products = await listPublishedProducts(filters);
  const itemTypeLabels = labelMap(taxonomy.itemTypes, locale);
  const styleLabels = labelMap(taxonomy.styles, locale);
  const colorHex = colorHexMap(taxonomy.colors);

  const itemTypeLabel = labelFor(itemType, locale);
  const roomLabel = room ? labelFor(room, locale) : null;

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
