import Link from "next/link";

/**
 * Large clickable tile used on the landing page (Rooms) and the
 * room page (Item types). Same aspect ratio as ProductCard so all
 * three layers feel like the same grid.
 *
 * Intentionally typographic — rooms and item_types don't carry hero
 * images in the DB. When we add a representative thumbnail column
 * later, drop it into the `<img>` slot here.
 */
export default function CategoryTile({
  href,
  label,
  count,
  countLabel,
}: {
  href: string;
  label: string;
  count: number;
  /** Localized "{count} items" — rendered verbatim (intl plural
   *  is baked in by the caller). */
  countLabel: string;
}) {
  const muted = count === 0;
  return (
    <Link
      href={href}
      className={`group flex flex-col overflow-hidden rounded-lg border bg-white transition hover:shadow-sm ${
        muted
          ? "border-neutral-200 hover:border-neutral-400"
          : "border-neutral-200 hover:border-black"
      }`}
    >
      <div className="relative flex aspect-square w-full items-center justify-center bg-gradient-to-br from-neutral-50 to-neutral-100 p-4 text-center">
        <div
          className={`text-lg font-semibold leading-tight transition group-hover:scale-[1.02] ${
            muted ? "text-neutral-400" : "text-neutral-900"
          }`}
        >
          {label}
        </div>
      </div>
      <div className="flex items-center justify-between px-3 py-2 text-xs text-neutral-500">
        <span>{countLabel}</span>
        <span aria-hidden="true" className="transition group-hover:translate-x-0.5">
          →
        </span>
      </div>
    </Link>
  );
}
