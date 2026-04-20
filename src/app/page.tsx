import { Suspense } from "react";
import { BRAND } from "@config/brand";
import FilterPanel from "@/components/FilterPanel";
import ProductCard from "@/components/ProductCard";
import { listPublishedProducts, type ProductFilters } from "@/lib/products";
import {
  CATEGORIES,
  STYLES,
  PRIMARY_COLORS,
  APPLICABLE_SPACES,
  type Category,
  type Style,
  type PrimaryColor,
  type ApplicableSpace,
} from "@/lib/constants/enums";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function pickOne<T extends readonly string[]>(
  v: string | string[] | undefined,
  allowed: T,
): T[number] | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  if (!s) return undefined;
  return (allowed as readonly string[]).includes(s) ? (s as T[number]) : undefined;
}

function pickMany<T extends readonly string[]>(
  v: string | string[] | undefined,
  allowed: T,
): T[number][] {
  const raw = Array.isArray(v) ? v.join(",") : v ?? "";
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.filter((p): p is T[number] => (allowed as readonly string[]).includes(p));
}

function parseFilters(sp: SearchParams): ProductFilters {
  const sort = pickOne(sp.sort, ["latest", "price_asc", "price_desc"] as const);
  return {
    q: typeof sp.q === "string" ? sp.q : undefined,
    category: pickOne(sp.category, CATEGORIES) as Category | undefined,
    styles: pickMany(sp.styles, STYLES) as Style[],
    colors: pickMany(sp.colors, PRIMARY_COLORS) as PrimaryColor[],
    spaces: pickMany(sp.spaces, APPLICABLE_SPACES) as ApplicableSpace[],
    sort,
  };
}

type PageProps = { searchParams: Promise<SearchParams> };

export default async function Home({ searchParams }: PageProps) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const products = await listPublishedProducts(filters);

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
          <FilterPanel />
        </Suspense>

        <section>
          {products.length === 0 ? (
            <div className="flex min-h-[40vh] items-center justify-center rounded-lg border border-dashed border-neutral-300 text-sm text-neutral-500">
              没有符合条件的商品，试试调整筛选。
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {products.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
