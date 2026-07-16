import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/config";
import { BRAND } from "@config/brand";
import { resolveLocale } from "@/i18n/request";
import {
  loadTaxonomy,
  labelMap,
} from "@/lib/taxonomy";
import {
  publishedCountsByItemType,
  coversByItemType,
  getInStockSubtypesByItemType,
} from "@/lib/products";
import { buildActiveCategories } from "@/lib/categories";
import { getDesignerSession } from "@/lib/auth/require-designer";
import { getCreditBalance } from "@/lib/credit";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { designerLogout } from "@/app/designer/actions";
import LanguageSwitcher from "./LanguageSwitcher";

/**
 * Sprint 1 — full-catalog, category-first header.
 *
 *   • Prominent center search (GET → /search).
 *   • DYNAMIC top nav: every item_type that has published products
 *     (buildActiveCategories), so the nav grows as Jym adds sofas /
 *     lighting / … without code changes. Links → /c/{item_type}.
 *   • CSS-only hover mega-menu: each category with subtypes shows a
 *     dropdown (category cover + subtype links). No JS — on touch the
 *     top link still navigates to the category page.
 *
 * Server component (async); embeds the client LanguageSwitcher. Used on
 * every storefront page; NOT under /admin.
 */
export default async function SiteHeader({
  tight = false,
}: {
  tight?: boolean;
}) {
  const [t, tCat, locale, sysLocale, taxonomy, counts, covers, inStockSubtypes] =
    await Promise.all([
      getTranslations("site"),
      getTranslations("category"),
      getLocale() as Promise<Locale>,
      resolveLocale(),
      loadTaxonomy(),
      publishedCountsByItemType(),
      coversByItemType(),
      getInStockSubtypesByItemType(),
    ]);

  const active = buildActiveCategories(
    taxonomy.itemTypes,
    counts,
    covers,
    taxonomy.itemSubtypes,
  )
    // In-stock gating: the mega-menu lists ONLY subtypes that a published
    // product actually carries — the same rule the /c chip bar applies —
    // so clicking a dropdown entry never lands on an empty subtype page.
    .map((c) => ({
      ...c,
      subtypeSlugs: c.subtypeSlugs.filter((st) =>
        (inStockSubtypes[c.slug] ?? []).includes(st),
      ),
    }));
  const itemTypeLabels = labelMap(taxonomy.itemTypes, locale);
  const subtypeLabels = labelMap(taxonomy.itemSubtypes, locale);

  // Designer login state — the storefront "Login" is the DESIGNER entry
  // (admin lives at a separate, unlinked /admin/login). When a designer
  // is signed in we show their name + credit + Logout instead.
  const designerSession = await getDesignerSession();
  let designer: { name: string; balance: number } | null = null;
  if (designerSession) {
    const svc = createServiceRoleClient();
    const [{ data: row }, balance] = await Promise.all([
      svc.from("designers").select("name").eq("id", designerSession.designerId).single(),
      getCreditBalance(designerSession.designerId),
    ]);
    designer = { name: row?.name ?? "Designer", balance: balance ?? 0 };
  }

  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white/95 backdrop-blur">
      {/* Top row: logo · prominent search · language + login */}
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

        {/* Prominent search — plain GET form, works without JS. */}
        <form action="/search" method="get" className="mx-auto hidden w-full max-w-xl sm:block">
          <div className="flex items-center rounded-full border border-neutral-300 bg-neutral-50 px-4 focus-within:border-neutral-900 focus-within:bg-white">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-neutral-400" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="search"
              name="q"
              placeholder={tCat("searchPlaceholder")}
              aria-label={tCat("search")}
              className="w-full bg-transparent px-3 py-2 text-sm focus:outline-none"
            />
          </div>
        </form>

        <div className="ml-auto flex shrink-0 items-center gap-3 sm:ml-0">
          <LanguageSwitcher current={sysLocale} />
          {designer ? (
            <>
              <Link
                href="/designer"
                className="hidden items-baseline gap-1.5 text-xs font-medium text-neutral-700 hover:text-neutral-900 sm:flex"
                title={tCat("dashboard")}
              >
                <span className="max-w-[10ch] truncate">{designer.name}</span>
                <span className="rounded-full bg-neutral-900 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  {designer.balance} credit
                </span>
              </Link>
              <form action={designerLogout}>
                <button
                  type="submit"
                  className="rounded-full border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 transition hover:border-neutral-900 hover:text-neutral-900"
                >
                  {tCat("logout")}
                </button>
              </form>
            </>
          ) : (
            <Link
              href="/designer/login"
              className="rounded-full border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 transition hover:border-neutral-900 hover:text-neutral-900"
            >
              {tCat("login")}
            </Link>
          )}
        </div>
      </div>

      {/* Category nav — dynamic, with CSS hover mega-menu. */}
      <nav
        aria-label="Categories"
        className="mx-auto max-w-7xl overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:overflow-visible"
      >
        <ul className="flex items-center gap-5 whitespace-nowrap text-sm">
          {active.map((c) => {
            const label = itemTypeLabels[c.slug] ?? c.slug;
            const hasMenu = c.subtypeSlugs.length > 0;
            return (
              <li key={c.slug} className="group relative">
                <Link
                  href={`/c/${c.slug}`}
                  className="inline-flex items-center gap-1 py-1 font-medium text-neutral-600 transition hover:text-neutral-900"
                >
                  {label}
                  {hasMenu && (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-neutral-400" aria-hidden>
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  )}
                </Link>
                {hasMenu && (
                  <div className="invisible absolute left-0 top-full z-50 w-64 translate-y-1 rounded-lg border border-neutral-200 bg-white p-3 opacity-0 shadow-lg transition group-hover:visible group-hover:translate-y-0 group-hover:opacity-100">
                    <div className="flex gap-3">
                      {c.coverUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={c.coverUrl}
                          alt=""
                          className="h-16 w-16 shrink-0 rounded object-cover"
                        />
                      )}
                      <ul className="flex flex-col gap-1.5">
                        {c.subtypeSlugs.map((st) => (
                          <li key={st}>
                            <Link
                              href={`/c/${c.slug}?subtype=${st}`}
                              className="text-xs text-neutral-600 hover:text-neutral-900"
                            >
                              {subtypeLabels[st] ?? st}
                            </Link>
                          </li>
                        ))}
                        <li>
                          <Link
                            href={`/c/${c.slug}`}
                            className="text-xs font-medium text-neutral-900 hover:underline"
                          >
                            {tCat("viewAll")} {label}
                          </Link>
                        </li>
                      </ul>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
