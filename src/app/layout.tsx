import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getLocale, getTranslations } from "next-intl/server";
import { BRAND } from "@config/brand";
import { LOCALES } from "@/i18n/config";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

/** Map our 2-letter locale to the BCP-47 + region OG/HTML expects.
 *  - Open Graph wants underscore variants (en_US, zh_CN, ms_MY).
 *  - hreflang wants hyphen variants (en, zh-CN, ms-MY).
 *  We don't gate by literal user IP — DecoRight serves Malaysia, so
 *  ms is ms-MY (not ms-ID), zh is zh-CN (the source-of-truth tagline
 *  is Simplified, matches BRAND.locale), en is en-US (no en-MY in
 *  Facebook's locale list anyway). */
const OG_LOCALE: Record<string, string> = {
  en: "en_US",
  zh: "zh_CN",
  ms: "ms_MY",
};

export async function generateMetadata(): Promise<Metadata> {
  const tSite = await getTranslations("site");
  const locale = await getLocale();
  const defaultTitle = `${BRAND.name} — ${tSite("tagline")}`;
  const description = tSite("metaDescription");
  return {
    // Resolves every relative URL in this metadata tree (and every
    // child page that doesn't supply its own metadataBase) against
    // the canonical origin. Without this, Next emits a build-time
    // warning AND falls back to localhost:3000 in dev / VERCEL_URL
    // in prod — neither of which is the URL you want crawlers to
    // store. See config/brand.ts for the rationale on hard-coding.
    metadataBase: new URL(BRAND.siteUrl),
    title: {
      default: defaultTitle,
      template: `%s · ${BRAND.name}`,
    },
    description,
    applicationName: BRAND.name,
    // Tell Google the same URL serves all three locales. Since we don't
    // use URL prefixes, every alternate points back to the same path;
    // this is a signal to crawlers that the content adapts per visitor.
    alternates: {
      languages: Object.fromEntries([
        ["x-default", "/"],
        ...LOCALES.map((l) => [l, "/"]),
      ]),
    },
    // Default Open Graph block. og:image is auto-injected by the
    // file-convention `app/opengraph-image.tsx` — we don't repeat
    // it here because explicit `images: [...]` would override that
    // file at the root level (defeating the point). Child segments
    // can override `openGraph.images` to swap the share preview
    // for a per-page artwork (commit 2 — product/room/item OG).
    openGraph: {
      type: "website",
      siteName: BRAND.name,
      title: defaultTitle,
      description,
      url: "/",
      locale: OG_LOCALE[locale] ?? "en_US",
      // The other two locales become og:locale:alternate, which
      // Facebook uses to surface the multilingual variants.
      alternateLocale: LOCALES.filter((l) => l !== locale).map(
        (l) => OG_LOCALE[l] ?? l,
      ),
    },
    // Twitter / X card. summary_large_image is the rectangular
    // preview (matches the 1200×630 we ship). twitter:image isn't
    // set — the X card spec falls back to og:image, which the file
    // convention has already populated. One image source, two
    // platforms.
    twitter: {
      card: "summary_large_image",
      title: defaultTitle,
      description,
    },
  };
}

/**
 * Mobile-first storefront foundation (Wave UI · Commit 1).
 *
 * Without an explicit viewport meta, mobile Safari renders the page at
 * its desktop default width and scales to fit, which downsizes type and
 * makes Tailwind's mobile-first breakpoints fire as if the device were
 * 980px wide. Setting `width: device-width` is the one-line fix that
 * lets every `sm:`/`md:` breakpoint below behave correctly.
 *
 * `initialScale: 1`     — render at 1:1 on first paint (no auto-zoom).
 * `maximumScale: 5`     — let users pinch-zoom for accessibility (we
 *                          do NOT lock zoom; some operators / interior
 *                          designers will want to inspect product
 *                          photos closely).
 * `viewportFit: cover`  — extends the layout under iOS safe-area
 *                          insets (notch / home indicator) so the
 *                          background color reaches the screen edge.
 *                          Per-component padding still respects insets
 *                          via Tailwind's `safe-` utilities where it
 *                          matters (none used yet — call it out if a
 *                          fixed CTA bar is added later).
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // getLocale() resolves to whatever our src/i18n/request.ts returned,
  // i.e. (cookie → Accept-Language → DEFAULT_LOCALE).
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html
      lang={locale}
      className={`${inter.variable} h-full antialiased`}
    >
      {/*
        No `flex flex-col` on body — see HScrollRail-scroll regression.
        Wave UI · Commit 3 (c2ecc35) had `flex flex-col` for an
        anticipated sticky-footer pattern, then patched the resulting
        regression with `overflow-x-hidden` because HScrollRail's
        content was leaking past the viewport. That fix was a band-aid:
        it clipped the visual overflow but left `<main>` sized at the
        rail's intrinsic content width. With `flex flex-col` on body,
        `<main>` is a flex item and inherits `min-width: auto`, which
        resolves to its descendants' min-content. The rail's `<ul>`
        is a flex container with `shrink-0` cards summing to ~1000px
        on mobile, so `<main>` was forced to 1000px and body's
        `overflow-x-hidden` clipped it visually. Side effect Wave 1
        missed: the rail's `<ul>` was sized at its own content width
        too, so its `overflow-x: auto` had nothing to scroll — users
        saw a frozen, fully-rendered IKEA strip.

        Removing `flex flex-col` makes `<main>` a normal block: width
        defaults to 100% of body, the rail's `<ul>` becomes narrower
        than its scroll content, and `overflow-x: auto` does its job.
        Re-introduce `flex flex-col` only alongside `[&>*]:min-w-0`
        on body when a sticky-footer pattern is actually shipped.

        `overflow-x-hidden` retained as defense in depth: with the
        root cause gone it has nothing to clip, but it keeps any
        future regression that reintroduces a wide unconstrained
        descendant from breaking the page horizontally before someone
        notices.
      */}
      <body className="min-h-full font-sans overflow-x-hidden">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
