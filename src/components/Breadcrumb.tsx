import Link from "next/link";
import { getTranslations } from "next-intl/server";

/**
 * Tiny server breadcrumb for the three-layer catalog nav:
 *   Home › Room › Item Type › Product
 *
 * The last item is always rendered as static text (no href). Earlier
 * items render as links. Accessible: wrapped in a `<nav aria-label>`
 * with an ordered list; the current page is marked `aria-current`.
 */
export type BreadcrumbItem = {
  label: string;
  /** Omit for the current page (trailing segment). */
  href?: string;
};

export default async function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  if (items.length === 0) return null;
  const tSite = await getTranslations("site");
  return (
    <nav aria-label={tSite("breadcrumb")} className="mb-6 text-sm text-neutral-500">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((it, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={`${i}-${it.label}`} className="flex items-center gap-1.5">
              {it.href && !isLast ? (
                <Link
                  href={it.href}
                  className="hover:text-black hover:underline"
                >
                  {it.label}
                </Link>
              ) : (
                <span
                  aria-current={isLast ? "page" : undefined}
                  className={isLast ? "text-neutral-900" : ""}
                >
                  {it.label}
                </span>
              )}
              {!isLast && (
                <span aria-hidden="true" className="text-neutral-300">
                  ›
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
