/**
 * Wave UI · Commit 4 — shared item-type card with cover-image variant.
 *
 * One card body, two visual states:
 *
 *   1. coverUrl present → product thumbnail fills the aspect-square
 *      top with `object-contain` on a soft neutral surface (cutouts
 *      are PNG-on-transparent, contain shows the whole product
 *      without cropping). Label + count sit in a small caption strip
 *      below the image — never overlaid, so the photo dominates and
 *      the text never fights with product silhouettes.
 *
 *   2. coverUrl null/empty → centered typographic tile on a gradient
 *      surface (the original ItemTypeRailCard shape). Label color
 *      mutes to neutral-400 when count is 0, signaling "we don't
 *      have any of these yet" while keeping the tile clickable so
 *      visitors can land on /item/<slug>'s clean empty state.
 *
 * Used in three callsites that previously had near-duplicate JSX:
 *
 *   • home `/`               — Browse by item rail
 *   • `/room/[slug]`         — Pick an item rail
 *   • `/room/[slug]`         — All categories grid (Commit 3)
 *
 * Render contract:
 *   • Caller owns the layout wrapper (<li> + width classes for rails,
 *     plain <li> for grids). This component renders ONLY the inner
 *     <Link>…</Link>; it has no opinion on width or list semantics.
 *     That keeps the rail's fixed-width + snap-start composition
 *     and the grid's flex-fill composition both clean.
 *   • `count` drives the muted state in the typographic fallback.
 *     The cover variant doesn't mute — if there's a cover image
 *     there's by definition stock, so muting can't apply.
 *   • `priority` opts the cover image into eager loading. Use it
 *     for the first 2-3 above-the-fold cards on each surface.
 *
 * Image strategy:
 * Plain <img>, mirroring RoomCard's convention. next/image would
 * require remotePatterns config for the Supabase storage host and
 * we deliberately keep storefront images unoptimized so bucket URLs
 * remain 1:1 swappable with Storage's public URL. Width hint in
 * `sizes` helps the browser pick the right resolution from the
 * srcset Storage emits when the upstream supports it (Storage
 * doesn't today — placeholder for the day it does).
 */
import Link from "next/link";

export default function ItemTypeCoverCard({
  href,
  label,
  count,
  countLabel,
  coverUrl,
  priority,
}: {
  href: string;
  label: string;
  /** Used to mute the typographic fallback when the room/category
   *  has zero stocked products. The cover variant never mutes (an
   *  image guarantees stock). */
  count: number;
  /** Localized "{count} items" string — rendered verbatim. */
  countLabel: string;
  /** Thumbnail URL of a representative product, or null when no
   *  stocked product has a cutout. Triggers the typographic fallback. */
  coverUrl: string | null | undefined;
  /** Eager-load the image. Set to true for the first 2-3 above-the-
   *  fold cards on each surface; default lazy-loads. */
  priority?: boolean;
}) {
  // Cover variant — image-led, caption below.
  if (coverUrl) {
    return (
      <Link
        href={href}
        className="
          group flex h-full flex-col overflow-hidden
          rounded-lg border border-neutral-200 bg-white
          transition active:scale-[0.98]
          hover:border-black hover:shadow-sm
        "
      >
        <div className="relative aspect-square w-full overflow-hidden bg-neutral-50">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={coverUrl}
            alt={label}
            loading={priority ? "eager" : "lazy"}
            fetchPriority={priority ? "high" : "auto"}
            // object-contain (not cover): cutouts have transparent
            // backgrounds and are framed tight to the silhouette;
            // cropping would clip handles/legs. p-3 gives breathing
            // room from the card edge so the product doesn't look
            // pinched.
            className="
              absolute inset-0 h-full w-full object-contain p-3
              transition duration-300
              group-hover:scale-[1.04]
              group-active:scale-[1.02]
            "
          />
        </div>
        <div className="flex items-baseline justify-between gap-2 px-2.5 py-1.5">
          <span className="truncate text-sm font-semibold text-neutral-900">
            {label}
          </span>
          <span className="shrink-0 text-[11px] text-neutral-500">
            {countLabel}
          </span>
        </div>
      </Link>
    );
  }

  // Typographic fallback — preserves the original rail card look so
  // the rail doesn't visually fracture when some types have covers
  // and others don't. Muted text when count === 0.
  const muted = count === 0;
  return (
    <Link
      href={href}
      className="
        group flex h-full flex-col overflow-hidden
        rounded-lg border border-neutral-200 bg-white
        transition active:scale-[0.98]
        hover:border-black hover:shadow-sm
      "
    >
      <div
        className="
          flex aspect-square w-full items-center
          justify-center bg-gradient-to-br
          from-neutral-50 to-neutral-100 p-3 text-center
        "
      >
        <span
          className={`text-sm font-semibold leading-tight transition group-hover:scale-[1.02] ${
            muted ? "text-neutral-400" : "text-neutral-900"
          }`}
        >
          {label}
        </span>
      </div>
      <div className="px-2.5 py-1.5 text-[11px] text-neutral-500">
        {countLabel}
      </div>
    </Link>
  );
}
