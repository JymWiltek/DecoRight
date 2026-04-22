import type { Metadata } from "next";
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
      <body className="min-h-full flex flex-col font-sans">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
