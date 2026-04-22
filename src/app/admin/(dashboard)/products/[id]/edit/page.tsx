import { notFound } from "next/navigation";
import ProductForm from "@/components/admin/ProductForm";
import ProductImagesSection from "@/components/admin/ProductImagesSection";
import { getProductById } from "@/lib/admin/products";
import { loadTaxonomy } from "@/lib/taxonomy";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getSignedRawUrl } from "@/lib/storage";
import { providerAvailability } from "@/lib/rembg";
import { updateProduct } from "../../actions";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    saved?: string;
    uploaded?: string;
    deleted?: string;
    approved?: string;
    rejected?: string;
    primary?: string;
    reran?: string;
    processed?: string;
    err?: string;
    msg?: string;
  }>;
};

export default async function EditProductPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const sp = await searchParams;

  const supabase = createServiceRoleClient();
  const [product, taxonomy, imagesResp] = await Promise.all([
    getProductById(id),
    loadTaxonomy(),
    supabase
      .from("product_images")
      .select("*")
      .eq("product_id", id)
      .order("created_at", { ascending: true }),
  ]);
  if (!product) notFound();

  // Private-bucket raw paths → short-lived signed URLs so the operator
  // can see what they uploaded before (or without) running rembg.
  const imagesWithPreviews = await Promise.all(
    (imagesResp.data ?? []).map(async (img) => ({
      ...img,
      raw_preview_url: img.raw_image_url
        ? await getSignedRawUrl(img.raw_image_url).catch(() => null)
        : null,
    })),
  );

  const avail = providerAvailability();

  const action = updateProduct.bind(null, id);

  return (
    <ProductForm
      product={product}
      taxonomy={taxonomy}
      action={action}
      saved={sp.saved === "1"}
      imagesSection={
        <ProductImagesSection
          productId={id}
          images={imagesWithPreviews}
          canRerunRemoveBg={avail.removebg}
          uploadedCount={sp.uploaded ? Number(sp.uploaded) : undefined}
          deletedCount={sp.deleted ? Number(sp.deleted) : undefined}
        />
      }
    />
  );
}
