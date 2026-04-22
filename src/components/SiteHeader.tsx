import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { BRAND } from "@config/brand";
import { resolveLocale } from "@/i18n/request";
import LanguageSwitcher from "./LanguageSwitcher";

/**
 * Shared public-site header. Server component so the brand/tagline
 * renders without a client roundtrip; it embeds a tiny client
 * LanguageSwitcher for the dropdown interactivity.
 *
 * Used on / and /product/[id]. NOT used under /admin — admin stays
 * English-only with no switcher.
 */
export default async function SiteHeader({
  tight = false,
}: {
  /** Compact variant (e.g. product detail) — smaller vertical padding. */
  tight?: boolean;
}) {
  const [t, locale] = await Promise.all([
    getTranslations("site"),
    resolveLocale(),
  ]);

  return (
    <header
      className={`border-b border-neutral-200 bg-white ${
        tight ? "py-3" : "py-4"
      }`}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4">
        <Link href="/" className="flex items-baseline gap-3">
          <span className="text-lg font-bold tracking-tight text-neutral-900">
            {BRAND.name}
          </span>
          <span className="hidden text-xs text-neutral-500 sm:inline">
            {t("tagline")}
          </span>
        </Link>
        <LanguageSwitcher current={locale} />
      </div>
    </header>
  );
}
