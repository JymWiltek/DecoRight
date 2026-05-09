import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import type { Metadata, ResolvingMetadata } from "next";
import type { Locale } from "@/i18n/config";
import SiteHeader from "@/components/SiteHeader";
import ProductDetail from "@/components/ProductDetail";
import Breadcrumb, { type BreadcrumbItem } from "@/components/Breadcrumb";
import { getPublishedProductById } from "@/lib/products";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getSignedRawUrl } from "@/lib/storage";
import { labelFor, labelMap, loadTaxonomy } from "@/lib/taxonomy";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata(
  { params }: PageProps,
  parent: ResolvingMetadata,
): Promise<Metadata> {
  const { id } = await params;
  const product = await getPublishedProductById(id);
  // Title is just the page noun; the brand suffix is appended by the
  // root layout's `title.template` ('%s · DecoRight'). Returning the
  // brand here too produced "<name> · DecoRight · DecoRight" in prod.
  if (!product) {
    const t = await getTranslations("product");
    return { title: t("notFound") };
  }
  // Per-product OG (Wave SEO commit 2).
  //
  // Image: products.thumbnail_url is the styled cutout already living
  // in a public Supabase Storage bucket (used as <img src> on
  // ProductCard) — handing it straight to og:image works because it's
  // a stable absolute URL. When a product has no thumbnail (rare —
  // happens during the upload→cutout window or if the operator
  // skipped photos for a 3D-only listing), we fall back to the parent
  // segment's resolved openGraph.images (i.e. the file-convention
  // /opengraph-image route emitted by app/opengraph-image.tsx). We
  // CANNOT just omit `images` — Next replaces the parent's openGraph
  // wholesale when the child returns its own block, which would drop
  // the file-convention image and emit a product page with NO og:image
  // at all (verified locally on a thumbnail-less product).
  //
  // Description: products.description is operator-written copy and
  // may be the empty string, null, or several paragraphs. Trim to
  // 160 chars (Facebook truncates beyond ~155, X around 200) and
  // append a "3D model · Download for SketchUp/Blender" tail when a
  // GLB is actually published. Adding the tail unconditionally would
  // lie on listings that haven't been 3D'd yet (mig 0014:
  // products.glb_url is NULL for those).
  const desc = product.description?.trim() ?? "";
  const trimmed =
    desc.length > 160 ? desc.slice(0, 157).trimEnd() + "…" : desc;
  const tail = product.glb_url
    ? " · 3D model · Download for SketchUp/Blender"
    : "";
  const ogDescription =
    (trimmed + tail).trim() ||
    `${product.name} on DecoRight — see it in 3D, live with AR, buy with confidence.`;
  const parentImages = (await parent).openGraph?.images ?? [];
  const ogImages = product.thumbnail_url
    ? [{ url: product.thumbnail_url, alt: product.name }]
    : parentImages;
  const twitterImages = product.thumbnail_url
    ? [product.thumbnail_url]
    : ((await parent).twitter?.images ?? []);
  return {
    title: product.name,
    description: ogDescription,
    openGraph: {
      type: "article",
      title: product.name,
      description: ogDescription,
      images: ogImages,
    },
    twitter: {
      card: "summary_large_image",
      title: product.name,
      description: ogDescription,
      images: twitterImages,
    },
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
      .select("id,raw_image_url,cutout_image_url,state,show_on_storefront,is_primary_thumbnail,created_at")
      .eq("product_id", id)
      .eq("state", "cutout_approved")
      .eq("show_on_storefront", true)
      // Mig 0038 — primary thumbnail leads, then by upload time.
      .order("is_primary_thumbnail", { ascending: false })
      .order("created_at", { ascending: true }),
  ]);
  if (!product) notFound();

  // Wave 5 (mig 0038) — flat image-pool model. Every show_on_storefront
  // row becomes a gallery slide, in order: primary thumbnail first,
  // then by upload time.
  //
  // Primary-thumbnail row: substitute products.thumbnail_url (the
  // unified 1500x1500 white-canvas PNG) so the gallery's lead slide
  // looks identical to the customer card. Per Jym's Wave 5 spec
  // "第 1 张默认显示 is_primary_thumbnail (跟产品卡封面一致)".
  // Non-primary rows: prefer the cutout URL (already public CDN);
  // fall back to a signed URL of the raw upload for rows without a
  // cutout (real photos, spec sheets the operator chose to show).
  const galleryUrls: string[] = [];
  for (const img of galleryResp.data ?? []) {
    if (img.is_primary_thumbnail && product.thumbnail_url) {
      galleryUrls.push(product.thumbnail_url);
      continue;
    }
    if (img.cutout_image_url) {
      galleryUrls.push(img.cutout_image_url);
    } else if (img.raw_image_url) {
      try {
        const signed = await getSignedRawUrl(img.raw_image_url);
        galleryUrls.push(signed);
      } catch {
        // Skip rows we can't sign — better than crashing the page.
      }
    }
  }

  const itemTypeLabels = labelMap(taxonomy.itemTypes, locale);
  const roomLabels = labelMap(taxonomy.rooms, locale);
  const styleLabels = labelMap(taxonomy.styles, locale);
  const materialLabels = labelMap(taxonomy.materials, locale);
  const regionLabels = labelMap(taxonomy.regions, locale);
  const colorsBySlug = new Map(taxonomy.colors.map((c) => [c.slug, c]));

  const itemTypeLabel = product.item_type
    ? (itemTypeLabels[product.item_type] ?? product.item_type)
    : null;
  // Migration 0013: rooms are a product column (products.room_slugs[])
  // — the product is the source of truth, no derivation. The product
  // detail page shows every room it belongs to.
  const productRoomSlugs = product.room_slugs ?? [];
  const itemTypeRow = product.item_type
    ? taxonomy.itemTypes.find((t) => t.slug === product.item_type)
    : null;
  const roomLabelList = productRoomSlugs.map((s) => roomLabels[s] ?? s);
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
  //
  // A product can belong to multiple rooms (Migration 0013). The
  // breadcrumb picks the FIRST room_slug for the mid-crumb — it's
  // a navigation affordance, not a classification, and we carry
  // `?room=<slug>` through to /item/* so that page knows which
  // room to scope and crumb.
  const primaryRoomSlug = productRoomSlugs[0] ?? null;
  const breadcrumb: BreadcrumbItem[] = [{ label: tSite("home"), href: "/" }];
  if (primaryRoomSlug) {
    breadcrumb.push({
      label: roomLabels[primaryRoomSlug] ?? primaryRoomSlug,
      href: `/room/${primaryRoomSlug}`,
    });
  }
  if (itemTypeRow && itemTypeLabel) {
    breadcrumb.push({
      label: itemTypeLabel,
      href: primaryRoomSlug
        ? `/item/${itemTypeRow.slug}?room=${primaryRoomSlug}`
        : `/item/${itemTypeRow.slug}`,
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
          galleryUrls={galleryUrls}
        />
      </main>
    </>
  );
}
