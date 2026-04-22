import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/config";
import SiteHeader from "@/components/SiteHeader";
import ProductDetail from "@/components/ProductDetail";
import Breadcrumb, { type BreadcrumbItem } from "@/components/Breadcrumb";
import { getPublishedProductById } from "@/lib/products";
import { labelFor, labelMap, loadTaxonomy } from "@/lib/taxonomy";
import { BRAND } from "@config/brand";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const product = await getPublishedProductById(id);
  if (!product) {
    const t = await getTranslations("product");
    return { title: `${t("notFound")} · ${BRAND.name}` };
  }
  return {
    title: `${product.name} · ${BRAND.name}`,
    description: product.description ?? undefined,
  };
}

export default async function ProductPage({ params }: PageProps) {
  const { id } = await params;
  const [product, taxonomy, tSite, locale] = await Promise.all([
    getPublishedProductById(id),
    loadTaxonomy(),
    getTranslations("site"),
    getLocale() as Promise<Locale>,
  ]);
  if (!product) notFound();

  const itemTypeLabels = labelMap(taxonomy.itemTypes, locale);
  const roomLabels = labelMap(taxonomy.rooms, locale);
  const styleLabels = labelMap(taxonomy.styles, locale);
  const materialLabels = labelMap(taxonomy.materials, locale);
  const colorsBySlug = new Map(taxonomy.colors.map((c) => [c.slug, c]));

  const itemTypeLabel = product.item_type
    ? (itemTypeLabels[product.item_type] ?? product.item_type)
    : null;
  // Post-migration 0003: room is derived from the item_type row, not
  // stored on the product. Look up the single parent room (if any).
  const itemTypeRow = product.item_type
    ? taxonomy.itemTypes.find((t) => t.slug === product.item_type)
    : null;
  const roomLabelList =
    itemTypeRow?.room_slug
      ? [roomLabels[itemTypeRow.room_slug] ?? itemTypeRow.room_slug]
      : [];
  const styleLabelList = product.styles.map((s) => styleLabels[s] ?? s);
  const materialLabelList = product.materials.map((s) => materialLabels[s] ?? s);

  const colorOptions = product.colors
    .map((slug) => {
      const c = colorsBySlug.get(slug);
      if (!c) return null;
      return { slug: c.slug, label: labelFor(c, locale), hex: c.hex };
    })
    .filter((c): c is { slug: string; label: string; hex: string } => c !== null);

  // Home › Room › Item Type › Product. Each ancestor is a link so a
  // visitor who arrived from a deep link (Google, shared URL) can
  // still climb back up the three-layer funnel. Skip any segment
  // whose data is missing — e.g. legacy products without an
  // item_type get "Home › Product" with no mid-layer rubble.
  const breadcrumb: BreadcrumbItem[] = [{ label: tSite("home"), href: "/" }];
  if (itemTypeRow?.room_slug) {
    breadcrumb.push({
      label: roomLabels[itemTypeRow.room_slug] ?? itemTypeRow.room_slug,
      href: `/room/${itemTypeRow.room_slug}`,
    });
  }
  if (itemTypeRow && itemTypeLabel) {
    breadcrumb.push({
      label: itemTypeLabel,
      href: `/item/${itemTypeRow.slug}`,
    });
  }
  breadcrumb.push({ label: product.name });

  return (
    <>
      <SiteHeader tight />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Breadcrumb items={breadcrumb} />
        <ProductDetail
          product={product}
          itemTypeLabel={itemTypeLabel}
          roomLabels={roomLabelList}
          styleLabels={styleLabelList}
          materialLabels={materialLabelList}
          colors={colorOptions}
        />
      </main>
    </>
  );
}
