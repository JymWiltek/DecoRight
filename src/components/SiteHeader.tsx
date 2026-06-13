import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { BRAND } from "@config/brand";
import { resolveLocale } from "@/i18n/request";
import { CATEGORIES } from "@/lib/categories";
import LanguageSwitcher from "./LanguageSwitcher";

/**
 * Shared public-site header. Server component so the brand/nav renders
 * without a client roundtrip; it embeds a tiny client LanguageSwitcher
 * for the dropdown interactivity.
 *
 * Wave 12 — category-first navigation. The header is now sticky and
 * carries the 7 bathroom categories (浴缸 / 马桶 / 洗手盆 / 龙头 / 淋浴 /
 * 浴室柜 / 配件) as a top-level nav, plus a search box and a Login link.
 * Designers think "I need a bathtub" first, then narrow by style — so
 * category is the primary axis (matches 3D66 / Coohom). Search is a
 * plain GET form to /search (no client JS needed). Used on every
 * storefront page; NOT under /admin.
 */
export default async function SiteHeader({
  tight = false,
}: {
  /** Compact variant (e.g. product detail) — smaller vertical padding. */
  tight?: boolean;
}) {
  const [t, tCat, locale] = await Promise.all([
    getTranslations("site"),
    getTranslations("category"),
    resolveLocale(),
  ]);

  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white/95 backdrop-blur">
      {/* Top row: logo · search · language + login */}
      <div
        className={`mx-auto flex max-w-7xl items-center gap-4 px-4 ${
          tight ? "py-2.5" : "py-3"
        }`}
      >
        <Link href="/" className="flex shrink-0 items-baseline gap-2">
          <span className="text-lg font-bold tracking-tight text-neutral-900">
            {BRAND.name}
          </span>
          <span className="hidden text-xs text-neutral-500 lg:inline">
            {t("tagline")}
          </span>
        </Link>

        {/* Search — plain GET form, works without JS. */}
        <form action="/search" method="get" className="ml-auto hidden flex-1 sm:block sm:max-w-xs">
          <input
            type="search"
            name="q"
            placeholder={tCat("searchPlaceholder")}
            aria-label={tCat("search")}
            className="w-full rounded-full border border-neutral-300 bg-neutral-50 px-4 py-1.5 text-sm focus:border-neutral-900 focus:bg-white focus:outline-none"
          />
        </form>

        <div className="ml-auto flex shrink-0 items-center gap-3 sm:ml-0">
          <LanguageSwitcher current={locale} />
          <Link
            href="/admin/login"
            className="rounded-full border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 transition hover:border-neutral-900 hover:text-neutral-900"
          >
            {tCat("login")}
          </Link>
        </div>
      </div>

      {/* Category nav — horizontal scroll on small screens. */}
      <nav
        aria-label="Categories"
        className="
          mx-auto max-w-7xl overflow-x-auto px-4 pb-2
          [scrollbar-width:none] [&::-webkit-scrollbar]:hidden
        "
      >
        <ul className="flex items-center gap-5 whitespace-nowrap text-sm">
          {CATEGORIES.map((c) => (
            <li key={c.slug}>
              <Link
                href={`/category/${c.slug}`}
                className="inline-block py-1 font-medium text-neutral-600 transition hover:text-neutral-900"
              >
                {tCat(c.slug)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
