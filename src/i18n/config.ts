/**
 * Canonical locale list + default. Keep this in sync with:
 *   - src/messages/*.json  (one file per locale)
 *   - src/i18n/request.ts  (loads the matching JSON)
 *   - SiteHeader language switcher (dropdown options)
 *
 * URL strategy:
 *   - No locale prefix in paths. decoright.my/product/xxx serves all
 *     three languages from the same URL; the locale is chosen per
 *     request from (cookie → Accept-Language → default).
 *   - hreflang alternates in <head> still point to the same URL for
 *     each language so Google knows the page is multilingual.
 */
export const LOCALES = ["en", "zh", "ms"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "locale";

/** Human-readable labels for the switcher. `native` shows in its own
 *  language; `english` is a reading aid for MS speakers who may not
 *  recognize "中文". */
export const LOCALE_LABELS: Record<Locale, { native: string; english: string }> = {
  en: { native: "English", english: "English" },
  zh: { native: "中文", english: "Chinese" },
  ms: { native: "Bahasa Melayu", english: "Malay" },
};

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}
