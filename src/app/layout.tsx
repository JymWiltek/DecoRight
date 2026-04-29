import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getLocale } from "next-intl/server";
import { BRAND } from "@config/brand";
import { LOCALES } from "@/i18n/config";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: `${BRAND.name} — See it, buy it`,
    template: `%s · ${BRAND.name}`,
  },
  description: `${BRAND.name}: a see-it, buy-it 3D/AR product catalog for Malaysia.`,
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
};

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
      <body className="min-h-full flex flex-col font-sans overflow-x-hidden">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
