import { notFound } from "next/navigation";
import Link from "next/link";
import ProductDetail from "@/components/ProductDetail";
import { getPublishedProductById } from "@/lib/products";
import { loadTaxonomy, labelMap } from "@/lib/taxonomy";
import { BRAND } from "@config/brand";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const product = await getPublishedProductById(id);
  if (!product) return { title: `未找到商品 · ${BRAND.name}` };
  return {
    title: `${product.name} · ${BRAND.name}`,
    description: product.description ?? undefined,
  };
}

export default async function ProductPage({ params }: PageProps) {
  const { id } = await params;
  const [product, taxonomy] = await Promise.all([
    getPublishedProductById(id),
    loadTaxonomy(),
  ]);
  if (!product) notFound();

  const itemTypeLabels = labelMap(taxonomy.itemTypes);
  const roomLabels = labelMap(taxonomy.rooms);
  const styleLabels = labelMap(taxonomy.styles);
  const materialLabels = labelMap(taxonomy.materials);
  const colorsBySlug = new Map(taxonomy.colors.map((c) => [c.slug, c]));

  const itemTypeLabel = product.item_type
    ? (itemTypeLabels[product.item_type] ?? product.item_type)
    : null;
  const roomLabelList = product.rooms.map((s) => roomLabels[s] ?? s);
  const styleLabelList = product.styles.map((s) => styleLabels[s] ?? s);
  const materialLabelList = product.materials.map((s) => materialLabels[s] ?? s);

  const colorOptions = product.colors
    .map((slug) => {
      const c = colorsBySlug.get(slug);
      if (!c) return null;
      return { slug: c.slug, label: c.label_zh, hex: c.hex };
    })
    .filter((c): c is { slug: string; label: string; hex: string } => c !== null);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 text-sm">
        <Link href="/" className="text-neutral-500 hover:text-black">
          ← 返回目录
        </Link>
      </div>
      <ProductDetail
        product={product}
        itemTypeLabel={itemTypeLabel}
        roomLabels={roomLabelList}
        styleLabels={styleLabelList}
        materialLabels={materialLabelList}
        colors={colorOptions}
      />
    </main>
  );
}
