/**
 * Wave UI · Commit 4 — fixed-width item-type card for HScrollRail.
 *
 * Extracted from the home page's inline rail JSX (Wave UI · Commit 2).
 * Three rails on three pages share this exact tile shape:
 *
 *   • home `/`               → Browse by item (top 8 by published count)
 *   • `/room/[slug]`         → Item types in this room (commit 4)
 *   • `/item/[slug]?room=`   → Sibling item types in same room (commit 5)
 *
 * Inlining the same JSX three times is the common path to drift —
 * one place adjusts the corner radius or hover state and the other
 * two silently diverge. One component keeps them locked.
 *
 * Width: fixed `w-32` mobile (≈128px) and `w-36` (≈144px) sm+. On a
 * 375px viewport with 12px gap, that lets ~2.6 cards peek above the
 * fold — enough to signal scrollability without crowding.
 *
 * Render contract:
 *   • Caller wraps in <li> via HScrollRail's child rules.
 *   • `href` is precomputed by the caller — different rails point at
 *     different URLs (home → /item/X; room/item pages → /item/X?room=Y).
 */
import Link from "next/link";

export default function ItemTypeRailCard({
  href,
  label,
  countLabel,
}: {
  href: string;
  label: string;
  /** Localized "{count} items" string — rendered verbatim. */
  countLabel: string;
}) {
  return (
    <li className="w-32 shrink-0 snap-start sm:w-36">
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
            className="
              text-sm font-semibold leading-tight
              text-neutral-900
              transition group-hover:scale-[1.02]
            "
          >
            {label}
          </span>
        </div>
        <div className="px-2.5 py-1.5 text-[11px] text-neutral-500">
          {countLabel}
        </div>
      </Link>
    </li>
  );
}
