import { notFound } from "next/navigation";
import Image from "next/image";
import { getLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import type { Locale } from "@/i18n/config";
import SiteHeader from "@/components/SiteHeader";
import ProductCard from "@/components/ProductCard";
import Breadcrumb from "@/components/Breadcrumb";
import { getPublishedBundle } from "@/lib/products";
import { loadTaxonomy, labelMap, colorHexMap } from "@/lib/taxonomy";
import { formatMYR } from "@/lib/format";
import { BRAND } from "@config/brand";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const data = await getPublishedBundle(id);
  if (!data) {
    const t = await getTranslations("bundle");
    return { title: t("notFound") };
  }
  return {
    title: data.bundle.name,
    description:
      data.bundle.description ??
      `${data.bundle.name} — a curated bathroom set on DecoRight. Download the full FBX bundle for designers.`,
  };
}

/**
 * Bundle detail page — a designer sales package (Feature 5). Reuses the
 * Wave 10 bundles / bundle_products tables (getPublishedBundle). Shows the
 * hero cover, the "套餐总价" (RM, summed from member products' prices), and
 * the included products as cards.
 *
 * DISPLAY ONLY — no payment gateway. The CTA is a WhatsApp (or email-
 * fallback) enquiry link, with online checkout marked "coming soon". A
 * dedicated discounted bundle price would be a one-line migration
 * (bundles.price_myr); until then the total is derived from members.
 */
export default async function BundlePage({ params }: PageProps) {
  const { id } = await params;
  const [data, taxonomy, tBundle, tSite, locale] = await Promise.all([
    getPublishedBundle(id),
    loadTaxonomy(),
    getTranslations("bundle"),
    getTranslations("site"),
    getLocale() as Promise<Locale>,
  ]);
  if (!data) notFound();
  const { bundle, products } = data;

  const itemTypeLabels = labelMap(taxonomy.itemTypes, locale);
  const styleLabels = labelMap(taxonomy.styles, locale);
  const subtypeLabels = labelMap(taxonomy.itemSubtypes, locale);
  const colorHex = colorHexMap(taxonomy.colors);

  // Feature 5 — designer sales package. "套餐总价" = the sum of member
  // products' RM prices. There's no dedicated bundles.price_myr column yet
  // (adding one is a one-line migration when a custom/discounted package
  // price is wanted — see report), so we compute the total from members.
  // Display-only: NO checkout / payment gateway. The CTA is a WhatsApp (or
  // email-fallback) enquiry — a placeholder while online ordering is built.
  const bundleTotalMyr = products.reduce(
    (sum, p) => sum + (p.price_myr ?? 0),
    0,
  );
  const enquiryText = tBundle("waText", { name: bundle.name });
  const enquiryHref = BRAND.whatsapp
    ? `https://wa.me/${BRAND.whatsapp}?text=${encodeURIComponent(enquiryText)}`
    : `mailto:${BRAND.email}?subject=${encodeURIComponent(
        bundle.name,
      )}&body=${encodeURIComponent(enquiryText)}`;
  // Primary CTA is "WhatsApp a Retailer" (wa.me when configured, else an
  // email-fallback placeholder keeping the WhatsApp label).
  const enquiryLabel = tBundle("whatsappRetailer");

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Breadcrumb
          items={[{ label: tSite("home"), href: "/" }, { label: bundle.name }]}
        />

        {/* Hero */}
        <section className="overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50">
          <div className="relative aspect-[21/9] w-full bg-neutral-100">
            {bundle.cover_image_url ? (
              // next/image (PR-D) — bundle hero as a viewport-width AVIF/WebP.
              <Image
                src={bundle.cover_image_url}
                alt={bundle.name}
                fill
                priority
                sizes="(min-width: 1024px) 960px, 100vw"
                className="object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-neutral-100 to-neutral-200 text-sm text-neutral-400">
                {bundle.name}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-end justify-between gap-4 p-6">
            <div>
              <h1 className="text-2xl font-semibold text-neutral-900">
                {bundle.name}
              </h1>
              <p className="mt-1 text-sm text-neutral-500">
                {tBundle("pieces", { count: products.length })}
              </p>
              {bundle.description && (
                <p className="mt-3 max-w-2xl text-sm leading-relaxed text-neutral-700">
                  {bundle.description}
                </p>
              )}
            </div>
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-wide text-neutral-400">
                {tBundle("total")}
              </div>
              <div className="text-3xl font-bold text-neutral-900">
                {formatMYR(bundleTotalMyr)}
              </div>
              <div className="mt-0.5 text-[11px] text-neutral-400">
                {tBundle("packageNote")}
              </div>
              {/* Feature 5 — placeholder CTA. NO payment gateway: this is a
                  WhatsApp (or email-fallback) enquiry link. Online checkout
                  is explicitly "coming soon". */}
              <div className="mt-3 flex flex-col items-stretch gap-1.5 sm:items-end">
                <a
                  href={enquiryHref}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="inline-flex items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700"
                >
                  <span aria-hidden>💬</span>
                  {enquiryLabel}
                </a>
                <span className="text-[11px] text-neutral-400">
                  {tBundle("buySoon")}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Included products */}
        <section className="mt-10">
          <h2 className="mb-4 text-lg font-semibold text-neutral-900">
            {tBundle("includes")}
          </h2>
          {products.length === 0 ? (
            <div className="flex min-h-[20vh] items-center justify-center rounded-lg border border-dashed border-neutral-300 px-4 text-center text-sm text-neutral-500">
              {tBundle("empty")}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {products.map((p, i) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  priority={i < 4}
                  itemTypeLabels={itemTypeLabels}
                  styleLabels={styleLabels}
                  subtypeLabels={subtypeLabels}
                  colorHex={colorHex}
                />
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
