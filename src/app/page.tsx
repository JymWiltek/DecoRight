import { Suspense } from "react";
import { BRAND } from "@config/brand";
import FilterPanel from "@/components/FilterPanel";
import ProductCard from "@/components/ProductCard";
import { listPublishedProducts, type ProductFilters } from "@/lib/products";
import { loadTaxonomy, labelMap, colorHexMap } from "@/lib/taxonomy";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

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

type PageProps = { searchParams: Promise<SearchParams> };

export default async function Home({ searchParams }: PageProps) {
  const sp = await searchParams;
  const taxonomy = await loadTaxonomy();

  const itemTypeSlugs = new Set(taxonomy.itemTypes.map((r) => r.slug));
  const roomSlugs = new Set(taxonomy.rooms.map((r) => r.slug));
  const styleSlugs = new Set(taxonomy.styles.map((r) => r.slug));
  const colorSlugs = new Set(taxonomy.colors.map((r) => r.slug));
  const materialSlugs = new Set(taxonomy.materials.map((r) => r.slug));

  const filters: ProductFilters = {
    q: typeof sp.q === "string" ? sp.q : undefined,
    itemTypes: pickMany(sp.item_types, itemTypeSlugs),
    rooms: pickMany(sp.rooms, roomSlugs),
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
  const itemTypeLabels = labelMap(taxonomy.itemTypes);
  const styleLabels = labelMap(taxonomy.styles);
  const colorHex = colorHexMap(taxonomy.colors);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <header className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{BRAND.name}</h1>
          <p className="mt-1 text-sm text-neutral-600">{BRAND.tagline}</p>
        </div>
        <div className="hidden text-xs text-neutral-500 sm:block">
          {products.length} 件商品
        </div>
      </header>

      <div className="grid gap-8 md:grid-cols-[240px_1fr]">
        <Suspense>
          <FilterPanel taxonomy={taxonomy} />
        </Suspense>

        <section>
          {products.length === 0 ? (
            <div className="flex min-h-[40vh] items-center justify-center rounded-lg border border-dashed border-neutral-300 text-sm text-neutral-500">
              没有符合条件的商品，试试调整筛选。
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {products.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
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
  );
}
