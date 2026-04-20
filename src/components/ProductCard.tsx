import Link from "next/link";
import { formatMYR } from "@/lib/format";
import { CATEGORY_LABELS, STYLE_LABELS } from "@/lib/constants/enum-labels";
import type { ProductRow } from "@/lib/supabase/types";

type Props = { product: ProductRow };

export default function ProductCard({ product }: Props) {
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
            loading="lazy"
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
          <span>{CATEGORY_LABELS[product.category]}</span>
          {product.style && (
            <>
              <span>·</span>
              <span>{STYLE_LABELS[product.style]}</span>
            </>
          )}
        </div>
        <div className="line-clamp-2 text-sm font-medium text-neutral-900">
          {product.name}
        </div>
        <div className="mt-auto pt-1 text-base font-semibold text-neutral-900">
          {formatMYR(product.price_myr)}
        </div>
      </div>
    </Link>
  );
}
