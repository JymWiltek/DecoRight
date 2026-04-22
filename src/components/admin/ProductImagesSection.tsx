import { UploadDropzone } from "./UploadDropzone";
import {
  uploadRawImages,
  processImage,
  processAllRaw,
  deleteProductImage,
} from "@/app/admin/(dashboard)/products/[id]/upload/actions";
import {
  approveCutout,
  rejectCutout,
  setPrimary,
} from "@/app/admin/(dashboard)/cutouts/actions";
import type { ImageState } from "@/lib/supabase/types";

/**
 * Inline image management, lives inside the product edit workbench.
 * This is the replacement for the separate /admin/products/[id]/upload
 * page — dropzone, batch cutout, and per-image state-dependent inline
 * actions (cut-out, approve, reject, re-run on Remove.bg, set primary,
 * delete) all render on the product edit page, so the operator never
 * loses the product context.
 *
 * Every action form carries a hidden `returnTo` pointing at the
 * edit page, so the post-action redirect lands back here. The same
 * actions are still used by /admin/cutouts for the queue-style review
 * workflow (no returnTo there → defaults to /admin/cutouts).
 *
 * Server component: renders pure markup + server-action forms. State
 * lives in the DB; every mutation triggers revalidatePath on this
 * route and the page re-renders with fresh data.
 */

type ImageWithPreview = {
  id: string;
  product_id: string;
  state: ImageState;
  raw_image_url: string | null;
  cutout_image_url: string | null;
  is_primary: boolean;
  rembg_provider: string | null;
  rembg_cost_usd: number | null;
  created_at: string;
  raw_preview_url: string | null;
};

type Props = {
  productId: string;
  images: ImageWithPreview[];
  canRerunRemoveBg: boolean;
  uploadedCount?: number;
  deletedCount?: number;
};

export default function ProductImagesSection({
  productId,
  images,
  canRerunRemoveBg,
  uploadedCount,
  deletedCount,
}: Props) {
  const returnTo = `/admin/products/${productId}/edit`;
  const rawCount = images.filter((i) => i.state === "raw").length;
  const pendingCount = images.filter(
    (i) => i.state === "cutout_pending",
  ).length;
  const approvedCount = images.filter(
    (i) => i.state === "cutout_approved",
  ).length;
  const rejectedCount = images.filter(
    (i) => i.state === "cutout_rejected",
  ).length;

  const boundUpload = uploadRawImages.bind(null, productId);
  const boundProcessAll = processAllRaw.bind(null, productId);

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-5">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Images ({images.length})
        </h2>
        <div className="flex items-center gap-1.5 text-[11px] text-neutral-500">
          {rawCount > 0 && <StatePill state="raw" count={rawCount} />}
          {pendingCount > 0 && (
            <StatePill state="cutout_pending" count={pendingCount} />
          )}
          {approvedCount > 0 && (
            <StatePill state="cutout_approved" count={approvedCount} />
          )}
          {rejectedCount > 0 && (
            <StatePill state="cutout_rejected" count={rejectedCount} />
          )}
        </div>
      </div>

      {/* success banners read from searchParams in the parent page and
          are wired in via the `uploadedCount` / `deletedCount` props */}
      {uploadedCount ? (
        <Banner tone="emerald">
          Uploaded {uploadedCount} raw image{uploadedCount === 1 ? "" : "s"}.
          Click &ldquo;Cut out&rdquo; below or &ldquo;Cut out all&rdquo; to
          run background removal.
        </Banner>
      ) : null}
      {deletedCount ? (
        <Banner tone="neutral">Image deleted.</Banner>
      ) : null}

      {/* uploader */}
      <form action={boundUpload} className="space-y-3">
        <input type="hidden" name="returnTo" value={returnTo} />
        <UploadDropzone
          name="files"
          accept="image/jpeg,image/png,image/webp"
          multiple
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-neutral-500">
            JPG / PNG / WebP · each ≤ 8 MB · Cutout runs on Replicate
            (~$0.001/img). Re-run on Remove.bg (~$0.20/img) for tough
            cases.
          </p>
          <div className="flex items-center gap-2">
            {rawCount > 0 && (
              <button
                type="submit"
                form="__cutout_all_form"
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:border-black"
                title={`Send all ${rawCount} raw images through rembg`}
              >
                Cut out all ({rawCount})
              </button>
            )}
            <button
              type="submit"
              className="rounded-md bg-black px-4 py-1.5 text-xs font-medium text-white hover:bg-neutral-800"
            >
              Upload
            </button>
          </div>
        </div>
      </form>

      {/* Batch-process form sits outside the upload form because HTML
          forbids nested forms. The "Cut out all" button above targets
          it by id. */}
      {rawCount > 0 && (
        <form id="__cutout_all_form" action={boundProcessAll} className="hidden">
          <input type="hidden" name="returnTo" value={returnTo} />
        </form>
      )}

      {/* list */}
      {images.length === 0 ? (
        <p className="mt-4 text-sm text-neutral-400">
          No images yet. Drop photos above to start.
        </p>
      ) : (
        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {images.map((img) => (
            <ImageCard
              key={img.id}
              image={img}
              returnTo={returnTo}
              canRerunRemoveBg={canRerunRemoveBg}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ImageCard({
  image,
  returnTo,
  canRerunRemoveBg,
}: {
  image: ImageWithPreview;
  returnTo: string;
  canRerunRemoveBg: boolean;
}) {
  const showCutout =
    image.cutout_image_url && image.state !== "raw";
  return (
    <div
      className={`rounded-md border p-2 text-xs ${
        image.is_primary
          ? "border-amber-300 ring-1 ring-amber-200"
          : "border-neutral-200"
      }`}
    >
      <div className="relative aspect-square overflow-hidden rounded bg-neutral-50">
        {showCutout ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image.cutout_image_url!}
            alt=""
            className="h-full w-full object-contain"
          />
        ) : image.raw_preview_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image.raw_preview_url}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-neutral-400">
            No preview
          </div>
        )}
        {image.is_primary && (
          <span className="absolute left-1.5 top-1.5 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-medium text-white shadow">
            Primary
          </span>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <StateTag state={image.state} />
        {image.rembg_provider && (
          <span className="text-[10px] text-neutral-500">
            {image.rembg_provider}
            {image.rembg_cost_usd != null && (
              <> · ${image.rembg_cost_usd.toFixed(3)}</>
            )}
          </span>
        )}
      </div>

      {/* state-specific inline actions */}
      <div className="mt-2 space-y-1.5">
        {image.state === "raw" && (
          <ActionForm
            action={processImage}
            label="Cut out"
            variant="primary"
            imageId={image.id}
            productId={image.product_id}
            returnTo={returnTo}
          />
        )}

        {image.state === "cutout_pending" && (
          <>
            <div className="flex gap-1.5">
              <ActionForm
                action={approveCutout}
                label="✓ Approve"
                variant="approve"
                imageId={image.id}
                returnTo={returnTo}
                className="flex-1"
              />
              <ActionForm
                action={rejectCutout}
                label="× Reject"
                variant="reject"
                imageId={image.id}
                returnTo={returnTo}
                className="flex-1"
              />
            </div>
            {canRerunRemoveBg && (
              <ActionForm
                action={rejectCutout}
                label="Re-run on Remove.bg"
                variant="neutral"
                imageId={image.id}
                returnTo={returnTo}
                extraInputs={{ rerun: "removebg" }}
                title="~$0.20 · higher quality"
              />
            )}
          </>
        )}

        {image.state === "cutout_approved" && !image.is_primary && (
          <ActionForm
            action={setPrimary}
            label="Set as primary"
            variant="neutral"
            imageId={image.id}
            returnTo={returnTo}
          />
        )}

        {image.state === "cutout_rejected" && (
          <>
            <ActionForm
              action={processImage}
              label="Re-run (Replicate)"
              variant="neutral"
              imageId={image.id}
              productId={image.product_id}
              returnTo={returnTo}
              extraInputs={{ providerId: "replicate_rembg" }}
            />
            {canRerunRemoveBg && (
              <ActionForm
                action={processImage}
                label="Re-run on Remove.bg"
                variant="neutral"
                imageId={image.id}
                productId={image.product_id}
                returnTo={returnTo}
                extraInputs={{ providerId: "removebg" }}
                title="~$0.20 · higher quality"
              />
            )}
          </>
        )}

        {/* Destructive: always available. Confirms client-side.
            Primary gets a sterner message because deleting primary
            wipes products.thumbnail_url and the catalog goes
            placeholder until another image is promoted. */}
        <form action={deleteProductImage}>
          <input type="hidden" name="imageId" value={image.id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <button
            type="submit"
            className="w-full rounded-md border border-neutral-200 px-3 py-1 text-[11px] text-neutral-500 hover:border-rose-300 hover:text-rose-600"
          >
            Delete
          </button>
        </form>
      </div>
    </div>
  );
}

/**
 * One-button server-action <form>. Keeps the card's per-state block
 * readable — every button is a form because React server actions
 * require it, and the hidden-input boilerplate is identical.
 */
function ActionForm({
  action,
  label,
  variant,
  imageId,
  productId,
  returnTo,
  extraInputs,
  className,
  title,
}: {
  action: (fd: FormData) => void | Promise<void>;
  label: string;
  variant: "primary" | "approve" | "reject" | "neutral";
  imageId: string;
  productId?: string;
  returnTo: string;
  extraInputs?: Record<string, string>;
  className?: string;
  title?: string;
}) {
  const cls = {
    primary:
      "bg-black text-white hover:bg-neutral-800 border border-transparent",
    approve:
      "bg-emerald-600 text-white hover:bg-emerald-700 border border-transparent",
    reject:
      "border border-neutral-300 hover:border-rose-500 hover:text-rose-600",
    neutral: "border border-neutral-300 hover:border-black",
  }[variant];

  return (
    <form action={action} className={className}>
      <input type="hidden" name="imageId" value={imageId} />
      {productId && (
        <input type="hidden" name="productId" value={productId} />
      )}
      <input type="hidden" name="returnTo" value={returnTo} />
      {extraInputs &&
        Object.entries(extraInputs).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
      <button
        type="submit"
        title={title}
        className={`w-full rounded-md px-3 py-1.5 text-[11px] font-medium ${cls}`}
      >
        {label}
      </button>
    </form>
  );
}

function StateTag({ state }: { state: ImageState }) {
  const map: Record<ImageState, { label: string; cls: string }> = {
    raw: { label: "Raw", cls: "bg-neutral-100 text-neutral-600" },
    cutout_pending: {
      label: "Pending",
      cls: "bg-amber-100 text-amber-800",
    },
    cutout_approved: {
      label: "Approved",
      cls: "bg-emerald-100 text-emerald-800",
    },
    cutout_rejected: {
      label: "Rejected",
      cls: "bg-rose-100 text-rose-700",
    },
  };
  const m = map[state];
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] ${m.cls}`}>
      {m.label}
    </span>
  );
}

function StatePill({
  state,
  count,
}: {
  state: ImageState;
  count: number;
}) {
  const map: Record<ImageState, string> = {
    raw: "bg-neutral-100 text-neutral-700",
    cutout_pending: "bg-amber-100 text-amber-800",
    cutout_approved: "bg-emerald-100 text-emerald-800",
    cutout_rejected: "bg-rose-100 text-rose-700",
  };
  const labels: Record<ImageState, string> = {
    raw: "raw",
    cutout_pending: "pending",
    cutout_approved: "approved",
    cutout_rejected: "rejected",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 ${map[state]}`}>
      {count} {labels[state]}
    </span>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "emerald" | "neutral";
  children: React.ReactNode;
}) {
  const cls = {
    emerald: "bg-emerald-50 text-emerald-700",
    neutral: "bg-neutral-50 text-neutral-700",
  }[tone];
  return (
    <div className={`mb-4 rounded-md ${cls} px-4 py-2 text-xs`}>
      {children}
    </div>
  );
}
