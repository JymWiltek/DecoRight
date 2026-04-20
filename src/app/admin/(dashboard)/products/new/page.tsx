import ProductForm from "@/components/admin/ProductForm";
import { createProduct } from "../actions";

export const dynamic = "force-dynamic";

export default function NewProductPage() {
  return <ProductForm action={createProduct} />;
}
