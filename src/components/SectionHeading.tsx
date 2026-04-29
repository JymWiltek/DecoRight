/**
 * Wave UI · Commit 1 — shared section heading for storefront pages.
 *
 * Used by /, /room/[slug], /item/[slug] to introduce horizontal rails
 * and grids ("Browse by item", "Rooms", "More in this room"). The
 * existing /room/[slug] uses an ad-hoc <h2> — that style is duplicated
 * here so the typography can shift in one place.
 *
 * Mobile-first sizing:
 *   • h2 base   = text-lg     (~18px on mobile — readable without
 *                              eating fold space)
 *   • h2 sm+    = text-xl     (slight bump on tablet/desktop)
 *   • subtitle  = text-sm muted
 *
 * Renders an h2 (page <h1> stays on the page itself: "Pick a room").
 * If a future section needs h3 nesting, add a `level` prop.
 */
export default function SectionHeading({
  title,
  subtitle,
  className = "",
}: {
  title: string;
  subtitle?: string;
  className?: string;
}) {
  return (
    <header className={`mb-3 ${className}`}>
      <h2 className="text-lg font-semibold text-neutral-900 sm:text-xl">
        {title}
      </h2>
      {subtitle ? (
        <p className="mt-1 text-sm text-neutral-600">{subtitle}</p>
      ) : null}
    </header>
  );
}
