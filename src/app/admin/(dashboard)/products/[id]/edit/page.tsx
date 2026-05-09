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
    /** Mig 0027 — set by markImageSkipCutout's success redirect. The
     *  ProductImagesSection turns this into a green confirmation banner
     *  ("Image marked as already clean — saved without rembg"). */
    skipped?: string;
    processed?: string;
    err?: string;
    msg?: string;
    /** Wave 2B · Commit 7: when err='publish_blocked', this names the
     *  first failing gate (rooms · cutouts · glb) so the form banner
     *  can render a targeted fix-this-next message. */
    reason?: string;
    /** Wave 2A · Commit 6 set this when the held-back-Publish path
     *  kicked off Meshy. Wave 2B · Commit 7 retires that path —
     *  updateProduct never sets `meshy=started` anymore. The flag is
     *  kept in the schema so MeshyStatusBanner's existing handling
     *  doesn't churn; it's just unreachable today. */
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

  // Wave 5 (mig 0038) — pool of images the AI parser may pick from.
  // Filter to feed_to_ai=true AND something the operator-side
  // already has a preview for (cutout_image_url public URL OR a
  // raw_preview_url signed URL we resolved above). Empty list →
  // SpecSheetAutofillBlock renders an upload-first hint.
  const aiCandidateImages = imagesWithPreviews
    .filter((i) => i.feed_to_ai)
    .map((i) => ({
      id: i.id,
      previewUrl: i.cutout_image_url ?? i.raw_preview_url,
    }));

  const avail = providerAvailability();

  const action = updateProduct.bind(null, id);

  // Route err codes to the right banner.
  //   - `meshy_*` → MeshyStatusBanner (Meshy pre-flight refusals)
  //   - `publish_blocked` → ProductForm (Wave 2B · Commit 7's 3-gate)
  //   - everything else (upload, db, rembg) → ProductImagesSection
  // `meshy_no_cutouts` is intentionally dropped — the rembg failure
  // banner already covers the same ground.
  const rawErr = sp.err ?? "";
  const isMeshyErr = rawErr.startsWith("meshy_");
  const isPublishErr = rawErr === "publish_blocked";
  const meshyBlockedReason =
    isMeshyErr && rawErr !== "meshy_no_cutouts"
      ? rawErr.replace(/^meshy_/, "")
      : undefined;
  // Translate the gate reason into a fix-this-next message that maps
  // to a button on this page. Centralized here so ProductForm stays a
  // dumb renderer.
  const PUBLISH_BLOCKED_MESSAGES: Record<string, string> = {
    rooms:
      "Pick at least one room in the Rooms picker below before publishing.",
    // Mig 0027 — operator may now satisfy the cutout gate two ways:
    // run rembg, OR mark a clean photo as Skipped (skip_cutout=true,
    // raw bytes copied to public bucket, lands at cutout_approved
    // exactly like a successful rembg run). Both routes count toward
    // cutoutApprovedCount because skip-cutout rows live in the same
    // state. Surfacing both options here so the operator knows they
    // don't have to burn rembg quota on a clean white-backdrop photo.
    cutouts:
      "Click \"Run Background Removal\" OR mark a clean image as Skipped so at least one cutout is approved before publishing.",
    glb:
      "Click \"Generate 3D model\" (or upload a .glb) so the product has a 3D model before publishing.",
  };
  const productErrCode = isPublishErr ? "publish_blocked" : undefined;
  const productErrMsg = isPublishErr
    ? (PUBLISH_BLOCKED_MESSAGES[sp.reason ?? ""] ??
        "This product is missing something required for Publish.")
    : undefined;
  const rembgErrCode = isMeshyErr || isPublishErr ? undefined : sp.err;
  const rembgErrMsg = isMeshyErr || isPublishErr ? undefined : sp.msg;

  return (
    <ProductForm
      product={product}
      taxonomy={taxonomy}
      action={action}
      saved={sp.saved === "1"}
      freshlyCreated={sp.fresh === "1"}
      errCode={productErrCode}
      errMsg={productErrMsg}
      aiCandidateImages={aiCandidateImages}
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
          skipped={sp.skipped === "1"}
          errCode={rembgErrCode}
          errMsg={rembgErrMsg}
          rembgUsage={rembgUsage}
        />
      }
    />
  );
}
