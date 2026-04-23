import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/config";
import SiteHeader from "@/components/SiteHeader";
import ProductDetail from "@/components/ProductDetail";
import Breadcrumb, { type BreadcrumbItem } from "@/components/Breadcrumb";
import { getPublishedProductById } from "@/lib/products";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getSignedRawUrl } from "@/lib/storage";
import {
  deriveRoomSlug,
  labelFor,
  labelMap,
  loadTaxonomy,
} from "@/lib/taxonomy";
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
  // Fetch product + taxonomy + i18n + the gallery's scene-photo
  // companions in parallel. The non-primary cutout_approved photos'
  // raw_image_url paths are private-bucket; we sign them here so the
  // gallery can render the originals as scene shots (SPEC 2 slide 3+).
  const supabase = createServiceRoleClient();
  const [product, taxonomy, tSite, locale, galleryResp] = await Promise.all([
    getPublishedProductById(id),
    loadTaxonomy(),
    getTranslations("site"),
    getLocale() as Promise<Locale>,
    supabase
      .from("product_images")
      .select("id,is_primary,raw_image_url,state")
      .eq("product_id", id)
      .eq("state", "cutout_approved")
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true }),
  ]);
  if (!product) notFound();

  // Original scene photos = every approved image EXCEPT the primary
  // (the primary's cutout is already shown as slide 1's styled
  // thumbnail; showing its raw too would be redundant).
  const originalCandidates = (galleryResp.data ?? []).filter(
    (img) => !img.is_primary && img.raw_image_url,
  );
  const originalRawUrls = (
    await Promise.all(
      originalCandidates.map(async (img) => {
        try {
          return await getSignedRawUrl(img.raw_image_url!);
        } catch {
          return null;
        }
      }),
    )
  ).filter((u): u is string => u !== null);

  const itemTypeLabels = labelMap(taxonomy.itemTypes, locale);
  const roomLabels = labelMap(taxonomy.rooms, locale);
  const styleLabels = labelMap(taxonomy.styles, locale);
  const materialLabels = labelMap(taxonomy.materials, locale);
  const regionLabels = labelMap(taxonomy.regions, locale);
  const colorsBySlug = new Map(taxonomy.colors.map((c) => [c.slug, c]));

  const itemTypeLabel = product.item_type
    ? (itemTypeLabels[product.item_type] ?? product.item_type)
    : null;
  // Migration 0011: subtype-aware. If a subtype was picked AND it
  // owns its own room_slug, that wins; otherwise fall back to
  // item_type.room_slug. Mirrors public.product_room_slug() in DB.
  const derivedRoomSlug = deriveRoomSlug(
    { item_type: product.item_type, subtype_slug: product.subtype_slug },
    taxonomy,
  );
  const itemTypeRow = product.item_type
    ? taxonomy.itemTypes.find((t) => t.slug === product.item_type)
    : null;
  const roomLabelList = derivedRoomSlug
    ? [roomLabels[derivedRoomSlug] ?? derivedRoomSlug]
    : [];
  const styleLabelList = product.styles.map((s) => styleLabels[s] ?? s);
  const materialLabelList = product.materials.map((s) => materialLabels[s] ?? s);
  const regionLabelList = product.store_locations.map(
    (s) => regionLabels[s] ?? s,
  );

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
  // Room slug here uses the derived (subtype-aware) value so
  // floating-TV-cabinets correctly link to /room/living_room even
  // though the item_type itself might be in a different room.
  const breadcrumb: BreadcrumbItem[] = [{ label: tSite("home"), href: "/" }];
  if (derivedRoomSlug) {
    breadcrumb.push({
      label: roomLabels[derivedRoomSlug] ?? derivedRoomSlug,
      href: `/room/${derivedRoomSlug}`,
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
          regionLabels={regionLabelList}
          originalRawUrls={originalRawUrls}
        />
      </main>
    </>
  );
}
