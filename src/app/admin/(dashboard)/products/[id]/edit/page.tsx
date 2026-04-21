import { notFound } from "next/navigation";
import ProductForm from "@/components/admin/ProductForm";
import { getProductById } from "@/lib/admin/products";
import { loadTaxonomy } from "@/lib/taxonomy";
import { updateProduct } from "../../actions";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
};

export default async function EditProductPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { saved } = await searchParams;
  const [product, taxonomy] = await Promise.all([
    getProductById(id),
    loadTaxonomy(),
  ]);
  if (!product) notFound();

  const action = updateProduct.bind(null, id);

  return (
    <ProductForm
      product={product}
      taxonomy={taxonomy}
      action={action}
      saved={saved === "1"}
    />
  );
}
