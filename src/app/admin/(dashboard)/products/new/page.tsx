import ProductForm from "@/components/admin/ProductForm";
import { loadTaxonomy } from "@/lib/taxonomy";
import { createProduct } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const taxonomy = await loadTaxonomy();
  return <ProductForm taxonomy={taxonomy} action={createProduct} />;
}
