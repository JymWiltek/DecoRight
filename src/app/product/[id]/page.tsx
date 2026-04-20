import { notFound } from "next/navigation";
import Link from "next/link";
import ProductDetail from "@/components/ProductDetail";
import { getPublishedProductById } from "@/lib/products";
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
  const product = await getPublishedProductById(id);
  if (!product) notFound();

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 text-sm">
        <Link href="/" className="text-neutral-500 hover:text-black">
          ← 返回目录
        </Link>
      </div>
      <ProductDetail product={product} />
    </main>
  );
}
