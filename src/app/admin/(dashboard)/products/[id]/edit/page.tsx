import { notFound } from "next/navigation";
import ProductForm from "@/components/admin/ProductForm";
import ProductImagesSection from "@/components/admin/ProductImagesSection";
import MeshyStatusBanner from "@/components/admin/MeshyStatusBanner";
import { getProductById, getProductRembgUsage } from "@/lib/admin/products";
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
    fresh?: string;
    uploaded?: string;
    approved?: string;
    failed?: string;
    deleted?: string;
    rejected?: string;
    primary?: string;
    reran?: string;
    retried?: string;
    unsatisfied?: string;
    processed?: string;
    err?: string;
    msg?: string;
    /** Set by updateProduct after a held-back Publish kicks off Meshy.
     *  Forces MeshyStatusBanner to render on the very next paint even
     *  if the kick-off DB write hasn't propagated to the next read
     *  yet (rare race; the banner self-corrects on its first 5s tick). */
    meshy?: string;
  }>;
};

export default async function EditProductPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const sp = await searchParams;

  const supabase = createServiceRoleClient();
  const [product, taxonomy, imagesResp, rembgUsage] = await Promise.all([
    getProductById(id),
    loadTaxonomy(),
    supabase
      .from("product_images")
      .select("*")
      .eq("product_id", id)
      .order("created_at", { ascending: true }),
    // P0-3: lifetime rembg cost rollup so the UI can show
    // per-image attempt counts and a section-level total instead of
    // last-attempt-only data on product_images.rembg_cost_usd.
    getProductRembgUsage(id),
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

  // Wave 2A · Commit 6: MeshyStatusBanner needs the cutout count to
  // decide whether to render the new "Ready to generate" CTA. Counted
  // here (the rows are already loaded) instead of inside the banner
  // so the server-rendered first paint is correct without a client
  // fetch.
  const cutoutApprovedCount = imagesWithPreviews.filter(
    (i) => i.state === "cutout_approved",
  ).length;

  const avail = providerAvailability();

  const action = updateProduct.bind(null, id);

  // P0-4: split rembg-bound and meshy-bound err codes so each lands
  // in the right banner. updateProduct redirects with
  // `?err=meshy_<reason>&msg=<detail>` for Meshy pre-flight refusals;
  // anything else is rembg/upload territory and stays with the images
  // section. `meshy_no_cutouts` is dropped here per spec — the
  // operator's already looking at the rembg failure banner.
  const rawErr = sp.err ?? "";
  const isMeshyErr = rawErr.startsWith("meshy_");
  const meshyBlockedReason =
    isMeshyErr && rawErr !== "meshy_no_cutouts"
      ? rawErr.replace(/^meshy_/, "")
      : undefined;
  const rembgErrCode = isMeshyErr ? undefined : sp.err;
  const rembgErrMsg = isMeshyErr ? undefined : sp.msg;

  return (
    <ProductForm
      product={product}
      taxonomy={taxonomy}
      action={action}
      saved={sp.saved === "1"}
      freshlyCreated={sp.fresh === "1"}
      errCode={rembgErrCode}
      errMsg={rembgErrMsg}
      meshyBanner={
        <MeshyStatusBanner
          productId={id}
          initial={{
            status: product.meshy_status,
            error: product.meshy_error,
            glbUrl: product.glb_url,
            productStatus: product.status,
            attempts: product.meshy_attempts,
          }}
          justKickedOff={sp.meshy === "started"}
          blockedReason={meshyBlockedReason}
          blockedDetail={meshyBlockedReason ? sp.msg : undefined}
          cutoutApprovedCount={cutoutApprovedCount}
        />
      }
      imagesSection={
        <ProductImagesSection
          productId={id}
          images={imagesWithPreviews}
          canRerunRemoveBg={avail.removebg}
          hasAnyProvider={avail.replicate_rembg || avail.removebg}
          uploadedCount={sp.uploaded ? Number(sp.uploaded) : undefined}
          approvedCount={sp.approved ? Number(sp.approved) : undefined}
          failedCount={sp.failed ? Number(sp.failed) : undefined}
          deletedCount={sp.deleted ? Number(sp.deleted) : undefined}
          unsatisfied={sp.unsatisfied === "1"}
          retried={sp.retried === "1"}
          errCode={rembgErrCode}
          errMsg={rembgErrMsg}
          rembgUsage={rembgUsage}
        />
      }
    />
  );
}
