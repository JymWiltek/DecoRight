/**
 * Wave UI · Commit 4 — fixed-width rail wrapper for the shared
 * `ItemTypeCoverCard`. Three rails share the same fixed-width tile:
 *
 *   • home `/`               → Browse by item (top 8 by published count)
 *   • `/room/[slug]`         → Item types in this room
 *   • `/item/[slug]?room=`   → Sibling item types in same room (future)
 *
 * Why this thin wrapper exists:
 *   • The shared `ItemTypeCoverCard` renders just the inner <Link>
 *     so it can drop into both rails (fixed-width + snap-start + <li>)
 *     and grids (flex-fill + plain <li>) without forking. This
 *     component owns the rail-specific list-item shape so the rail's
 *     parent <ul> contract stays correct.
 *   • Width: `w-32` mobile (≈128px), `w-36` (≈144px) sm+. On a 375px
 *     viewport with 12px gap, ~2.6 cards peek above the fold —
 *     enough to signal scrollability without crowding.
 *
 * Render contract:
 *   • Caller wraps in <ul> via HScrollRail's child rules; this
 *     component supplies the <li>.
 *   • All visual concerns (image, typographic fallback, muted state)
 *     live in `ItemTypeCoverCard` so a tweak there updates rails AND
 *     grids in one place. Was previously inlined here pre-Commit 4.
 */
import ItemTypeCoverCard from "./ItemTypeCoverCard";

export default function ItemTypeRailCard({
  href,
  label,
  count,
  countLabel,
  coverUrl,
  priority,
}: {
  href: string;
  label: string;
  /** Drives the typographic-fallback muted state. Defaults to >0
   *  for backward-compat with rails that haven't been updated to
   *  pass it (the Browse-by-item rail on home pre-Commit 4 only
   *  passed countLabel). */
  count?: number;
  /** Localized "{count} items" string — rendered verbatim. */
  countLabel: string;
  /** Cover image; null/undefined falls back to typographic tile. */
  coverUrl?: string | null;
  /** Eager-load the cover. Use for the first 2-3 cards in the rail. */
  priority?: boolean;
}) {
  return (
    <li className="w-32 shrink-0 snap-start sm:w-36">
      <ItemTypeCoverCard
        href={href}
        label={label}
        count={count ?? 1}
        countLabel={countLabel}
        coverUrl={coverUrl}
        priority={priority}
      />
    </li>
  );
}
