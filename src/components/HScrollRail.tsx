/**
 * Wave UI · Commit 1 — reusable horizontal-snap rail.
 *
 * Used by:
 *   • home `/` Section 1: Item Type rail (commit 2)
 *   • `/room/[slug]`: Item-types-in-this-room rail (commit 4)
 *   • `/item/[slug]`: Sibling-item-types-in-same-room rail (commit 5)
 *
 * Why a shared component instead of inline `flex overflow-x-auto`:
 * iOS scroll-snap, scrollbar hiding, and edge-padding are easy to get
 * wrong individually and trivial to drift between three rails on three
 * pages. One component = one source of truth.
 *
 * Mobile-first behavior:
 *   • `snap-x snap-mandatory` — items lock into place (IKEA-style).
 *   • `snap-start` on each child — leftmost edge aligns with the
 *     viewport-left of the rail.
 *   • `pl-4 pr-4` (matches outer page padding) so the first card has
 *     a left gutter equal to the page edge — feels native.
 *   • `[scrollbar-width:none]` + `[&::-webkit-scrollbar]:hidden` —
 *     desktop browsers don't render a horizontal scrollbar that
 *     would feel out of place on a mobile design.
 *   • No JS — pure CSS scroll-snap. Works in Server Components.
 *
 * Fixed-width children:
 *   The rail does NOT enforce child widths. Callers set their own
 *   (`w-32`, `w-44`, `w-1/2`) since item-type tiles and room tiles
 *   want different widths. The rail just provides scroll behavior +
 *   gutters + snap.
 */

type Props = {
  /** Each child should be a fixed-width card. The rail wraps them in
   *  snap-start scroll children. */
  children: React.ReactNode;
  /** Extra Tailwind classes for the outer wrapper (e.g. `mt-4`). */
  className?: string;
  /** Aria label for assistive tech — describe what the rail contains
   *  ("Item types"). Falls back to `region` semantics. */
  ariaLabel?: string;
};

export default function HScrollRail({
  children,
  className = "",
  ariaLabel,
}: Props) {
  return (
    <div
      // -mx-4 cancels the parent's px-4 so the rail can bleed to the
      // viewport edges; we re-add the gutter via px-4 below. This is
      // the standard "edge-to-edge horizontal scroller in a padded
      // container" pattern and lets the last card scroll all the way
      // off-screen instead of stopping at the page padding.
      className={`-mx-4 ${className}`}
      role="region"
      aria-label={ariaLabel}
    >
      <ul
        className="
          flex snap-x snap-mandatory gap-3 overflow-x-auto
          px-4 pb-2
          [scrollbar-width:none]
          [&::-webkit-scrollbar]:hidden
        "
      >
        {/* Caller passes <li> children OR plain elements. To stay
         *  flexible (and keep the shared component dumb), we don't
         *  auto-wrap — callers always emit <li> directly. The eslint
         *  rule that complains about non-li children in <ul> stays
         *  honest because every rail user passes <li>. */}
        {children}
      </ul>
    </div>
  );
}
