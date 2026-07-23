import Link from "next/link";
import type { ProductRow } from "@/lib/supabase/types";
import { getDesignerSession } from "@/lib/auth/require-designer";

type Props = {
  product: ProductRow;
  itemTypeLabels: Record<string, string>;
  styleLabels: Record<string, string>;
  /** Wave 12 — subtype slug → label (e.g. freestanding → "Freestanding").
   *  Optional so older call sites keep compiling; when absent the tag
   *  line falls back to style · item-type. */
  subtypeLabels?: Record<string, string>;
  colorHex: Record<string, string>;
  /**
   * Above-the-fold cards render eagerly with `fetchpriority=high` so the
   * browser discovers the LCP image before hydration. Pass `true` for
   * the first row of the grid.
   */
  priority?: boolean;
  /**
   * Masonry mode (the /c listing redesign): render the image at its
   * NATURAL aspect ratio (no 3:4 crop) and source it from the
   * /api/card-image trim route (strips white borders off spec drawings).
   * Default false → fixed 3:4 + raw thumbnail_url (home/related/search
   * keep the old uniform grid).
   */
  masonry?: boolean;
};

/** Pull the cache-bust token out of a thumbnail_url's `?v=` so the
 *  trim route's response can be cached hard yet refresh when the
 *  thumbnail changes. */
function thumbVersion(url: string): string {
  return url.match(/[?&]v=([^&]+)/)?.[1] ?? "1";
}

/**
 * Wave 12 — Pinterest-style product card.
 *
 *   • 3:4 vertical image (was 1:1) — gives Wiltek's scene renders room
 *     to breathe and reads like the 3D66 / Coohom catalogs designers
 *     know.
 *   • Image = products.thumbnail_url, which Phase A made "raw scene
 *     photo as-is" by default, swapping to the unified white-canvas PNG
 *     only after an operator clicks Unify Center. So the card shows the
 *     real Wiltek render when there is one, and the clean cutout
 *     otherwise — no card-side logic needed.
 *   • AR badge appears on hover when the product has a 3D model.
 *   • One tag line: style · subtype.
 *   • Color dots (colorways).
 *   • "X credit" download price (download_credit_cost) — DISPLAY ONLY
 *     this wave (no paywall). The unit word stays English ("credit"),
 *     matching the spec mockup, like the hardcoded "RM" elsewhere.
 */
export default async function ProductCard({
  product,
  itemTypeLabels,
  styleLabels,
  subtypeLabels,
  colorHex,
  priority = false,
  masonry = false,
}: Props) {
  // Credit is a designer-download concept — the storefront must NEVER expose
  // it to a consumer or logged-out visitor (Jym). Gating here, inside the one
  // card component every listing renders, means no call site can leak it; the
  // session read is React-cached so a whole grid costs one JWT verify.
  const designerLoggedIn = (await getDesignerSession()) !== null;
  const styleLabel = product.styles[0] ? styleLabels[product.styles[0]] : null;
  const subtypeLabel = product.subtype_slug
    ? subtypeLabels?.[product.subtype_slug]
    : null;
  const itemTypeLabel = product.item_type
    ? itemTypeLabels[product.item_type]
    : null;
  // Prefer style · subtype; fall back to style · item-type, then either
  // alone — never render a stray "·".
  const tag =
    [styleLabel, subtypeLabel ?? itemTypeLabel].filter(Boolean).join(" · ") ||
    null;
  const has3d = Boolean(product.glb_url || product.glb_compressed_url);

  return (
    <Link
      href={`/product/${product.id}`}
      className="group flex flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white transition hover:border-neutral-400 hover:shadow-sm"
    >
      <div
        className={`relative w-full overflow-hidden bg-neutral-100 ${
          // Masonry images flow at natural height (h-auto). Reserve a
          // min-height so a not-yet-loaded / slow card-image (e.g. a
          // freshly-uploaded cover still warming) shows a neutral placeholder
          // box instead of collapsing to zero height — a collapsed card made
          // whole categories look empty/dead.
          masonry ? "min-h-[200px]" : "aspect-[3/4]"
        }`}
        // Masonry: make this the container-query container so the image's
        // max-height can be expressed relative to the card WIDTH (cqw).
        style={masonry ? { containerType: "inline-size" } : undefined}
      >
        {product.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            // Always the compressed list thumbnail (600 px WebP via the
            // card-image route) — never the ~2 MB stored original. The
            // product page loads the full image separately.
            src={`/api/card-image/${product.id}?v=${thumbVersion(product.thumbnail_url)}`}
            alt={product.name}
            loading={priority ? "eager" : "lazy"}
            fetchPriority={priority ? "high" : "auto"}
            className={
              // GLOBAL rule: object-contain + centered → the whole product
              // is always visible, never cropped / head-cut, whatever the
              // aspect ratio. The neutral container bg letterboxes off-ratio
              // images. Masonry still caps runaway-tall covers at 2:3
              // (max-h-[150cqw]) but now letterboxes instead of cropping.
              masonry
                ? "block h-auto max-h-[150cqw] w-full object-contain object-center transition duration-300 group-hover:opacity-95"
                : "h-full w-full object-contain object-center transition duration-300 group-hover:scale-[1.03]"
            }
          />
        ) : (
          <div
            className={`flex w-full items-center justify-center text-xs text-neutral-400 ${
              masonry ? "aspect-square" : "h-full"
            }`}
          >
            3D · AR
          </div>
        )}
        {has3d && (
          <span className="pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/75 px-2 py-0.5 text-[10px] font-medium text-white opacity-0 backdrop-blur-sm transition group-hover:opacity-100">
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M12 2 2 7l10 5 10-5-10-5Z" />
              <path d="m2 17 10 5 10-5" />
              <path d="m2 12 10 5 10-5" />
            </svg>
            AR
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <div className="line-clamp-2 text-sm font-medium text-neutral-900">
          {product.name}
        </div>
        {tag && <div className="text-xs text-neutral-500">{tag}</div>}
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
        {designerLoggedIn && (
          <div className="mt-auto pt-1 text-sm font-semibold text-neutral-900">
            {product.download_credit_cost} credit
          </div>
        )}
      </div>
    </Link>
  );
}
