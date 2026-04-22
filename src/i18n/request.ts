import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALES, isLocale, type Locale } from "./config";

/**
 * Resolve the active locale for this request. Priority:
 *   1. `locale` cookie — user's explicit choice (set by switcher action)
 *   2. Accept-Language header — first-visit heuristic for MY audience
 *      (23% Chinese speakers, tiny Malay-default population browsing
 *      furniture ecommerce, most default to en). If the browser prefers
 *      zh-* or ms-*, honor that; otherwise default to en.
 *   3. DEFAULT_LOCALE ("en").
 *
 * Note: we CAN'T set the cookie from here — getRequestConfig runs in a
 * render context, not a response-mutating context. That means an un-
 * switched browser re-sniffs every request. It's fine: sniffing is
 * cheap (string split) and the moment the user clicks the switcher
 * once, the cookie freezes.
 */
export async function resolveLocale(): Promise<Locale> {
  const jar = await cookies();
  const fromCookie = jar.get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;

  const hdrs = await headers();
  const accept = hdrs.get("accept-language") ?? "";
  // Parse "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7" → ["zh-cn","zh","en-us","en"]
  const ranked = accept
    .split(",")
    .map((p) => p.trim().split(";")[0]?.toLowerCase())
    .filter(Boolean);
  for (const tag of ranked) {
    // Strip region: zh-CN → zh, ms-MY → ms.
    const base = tag.split("-")[0];
    if ((LOCALES as readonly string[]).includes(base)) {
      return base as Locale;
    }
  }
  return DEFAULT_LOCALE;
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  const messages = (await import(`../messages/${locale}.json`)).default;
  return { locale, messages };
});
