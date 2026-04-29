/**
 * Wave UI · Commit 3 — image-led room card for the home grid.
 *
 * Replaces CategoryTile for the room layer specifically. Two visual
 * states:
 *
 *   1. cover_url present → big image fills the aspect-square top,
 *      label + count overlaid as a gradient bottom strip. This is
 *      the Notion-design state ("see the kitchen, click the
 *      kitchen") and the one the home page reaches first for the
 *      6 promoted rooms.
 *
 *   2. cover_url null → falls back to the gradient-text tile
 *      identical to CategoryTile. The 6 legacy quasi-rooms in the
 *      DB (Curtain, Door, Lighting, …) hit this branch — the
 *      design intentionally doesn't push them but they still
 *      navigate.
 *
 * Why a new component instead of folding into CategoryTile:
 * CategoryTile is shared with /room/[slug]'s item-type tiles; those
 * have no covers, only labels. Adding a cover_url branch to
 * CategoryTile would either complicate that call site or invite
 * drift. Keeping rooms-with-covers a separate component is cleaner.
 *
 * Image strategy:
 * Plain <img> — matches ProductCard's convention. next/image would
 * need next.config.ts `images.remotePatterns` for the Supabase
 * storage host, and the project deliberately keeps the storefront
 * unoptimized so the bucket URLs are 1:1 swappable. Loading is
 * `eager` because the home grid is the first painted block.
 */
import Link from "next/link";

export default function RoomCard({
  href,
  label,
  count,
  countLabel,
  coverUrl,
}: {
  href: string;
  label: string;
  count: number;
  /** Localized "{count} items" — rendered verbatim. */
  countLabel: string;
  /** Public URL of the room cover photo. Null falls back to
   *  typographic tile (same look as CategoryTile). */
  coverUrl: string | null;
}) {
  const muted = count === 0;

  if (!coverUrl) {
    // Typographic fallback. Mirrors CategoryTile so the home grid
    // looks coherent when some rooms have covers and some don't.
    return (
      <Link
        href={href}
        className={`group flex flex-col overflow-hidden rounded-lg border bg-white transition active:scale-[0.99] ${
          muted
            ? "border-neutral-200 hover:border-neutral-400"
            : "border-neutral-200 hover:border-black hover:shadow-sm"
        }`}
      >
        <div className="relative flex aspect-square w-full items-center justify-center bg-gradient-to-br from-neutral-50 to-neutral-100 p-4 text-center">
          <span
            className={`text-lg font-semibold leading-tight transition group-hover:scale-[1.02] ${
              muted ? "text-neutral-400" : "text-neutral-900"
            }`}
          >
            {label}
          </span>
        </div>
        <div className="flex items-center justify-between px-3 py-2 text-xs text-neutral-500">
          <span>{countLabel}</span>
          <span aria-hidden="true">→</span>
        </div>
      </Link>
    );
  }

  // Cover-image variant. Image fills aspect-square; label + count
  // sit in an overlaid bottom gradient so the photo dominates and
  // text stays readable on any color.
  return (
    <Link
      href={href}
      className="
        group relative block overflow-hidden rounded-lg
        border border-neutral-200 bg-neutral-50
        transition active:scale-[0.99]
        hover:border-black hover:shadow-md
      "
    >
      <div className="relative aspect-square w-full overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={coverUrl}
          alt={label}
          // Above-the-fold for the first ~4 cards on mobile; the rest
          // can lazy-load. Caller can opt out by passing a different
          // strategy in a future commit if needed.
          loading="eager"
          fetchPriority="high"
          // Slightly zoom on hover/active so the card feels tactile
          // on touch (active) and on cursor (hover).
          className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.03] group-active:scale-[1.02]"
        />
        {/* Bottom gradient + text overlay — gives the label a guaranteed
         *  contrast surface no matter the photo. */}
        <div
          className="
            absolute inset-x-0 bottom-0 flex items-end justify-between
            bg-gradient-to-t from-black/65 via-black/30 to-transparent
            px-3 pb-2.5 pt-10
          "
        >
          <div className="min-w-0">
            <div className="text-base font-semibold text-white drop-shadow-sm">
              {label}
            </div>
            <div className="mt-0.5 text-[11px] text-white/85">
              {countLabel}
            </div>
          </div>
          <span
            aria-hidden="true"
            className="
              text-white/90
              translate-x-0 transition group-hover:translate-x-0.5
            "
          >
            →
          </span>
        </div>
      </div>
    </Link>
  );
}
