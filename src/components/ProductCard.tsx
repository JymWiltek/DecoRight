import Link from "next/link";
import { formatMYR } from "@/lib/format";
import type { ProductRow } from "@/lib/supabase/types";

type Props = {
  product: ProductRow;
  itemTypeLabels: Record<string, string>;
  styleLabels: Record<string, string>;
  colorHex: Record<string, string>;
  /**
   * Above-the-fold cards should render their thumbnail eagerly with
   * `fetchpriority=high` so the browser can discover and fetch the
   * LCP candidate before hydration. Pass `true` for the first row of
   * the grid (typically 4 on desktop, 2 on mobile; passing 4 is a
   * good compromise — the redundant `high` on the 3rd/4th cards is
   * harmless on mobile because only 2 are actually above the fold).
   *
   * Before this prop existed every card was `loading="lazy"`, which
   * made the LCP image on `/item/<slug>` invisible to the preload
   * scanner (Lighthouse lcp-lazy-loaded / lcp-discovery warnings).
   */
  priority?: boolean;
};

export default function ProductCard({
  product,
  itemTypeLabels,
  styleLabels,
  colorHex,
  priority = false,
}: Props) {
  const typeLabel = product.item_type ? itemTypeLabels[product.item_type] : null;
  const styleLabel = product.styles[0] ? styleLabels[product.styles[0]] : null;

  return (
    <Link
      href={`/product/${product.id}`}
      className="group flex flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white transition hover:border-neutral-400 hover:shadow-sm"
    >
      <div className="relative aspect-square w-full overflow-hidden bg-neutral-100">
        {product.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.thumbnail_url}
            alt={product.name}
            loading={priority ? "eager" : "lazy"}
            fetchPriority={priority ? "high" : "auto"}
            className="h-full w-full object-cover transition group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-neutral-400">
            3D · AR
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          {typeLabel && <span>{typeLabel}</span>}
          {typeLabel && styleLabel && <span>·</span>}
          {styleLabel && <span>{styleLabel}</span>}
        </div>
        <div className="line-clamp-2 text-sm font-medium text-neutral-900">
          {product.name}
        </div>
        {product.colors.length > 0 && (
          <div className="flex items-center gap-1">
            {product.colors.slice(0, 5).map((slug) => (
              <span
                key={slug}
                className="h-3 w-3 rounded-full border border-neutral-200"
                style={{ backgroundColor: colorHex[slug] ?? "#ccc" }}
              />
            ))}
          </div>
        )}
        <div className="mt-auto pt-1 text-base font-semibold text-neutral-900">
          {formatMYR(product.price_myr)}
        </div>
      </div>
    </Link>
  );
}
