import { UploadDropzone } from "./UploadDropzone";
import DeleteImageButton from "./DeleteImageButton";
import {
  uploadRawImages,
  markImageUnsatisfied,
  retryFailedImage,
} from "@/app/admin/(dashboard)/products/[id]/edit/image-actions";
import type { ImageState } from "@/lib/supabase/types";

/**
 * Inline image management on the product edit workbench. Post-0010 the
 * pipeline is fully automatic — drop a photo, the server action runs
 * Replicate rembg synchronously, lands the row at cutout_approved (and
 * promotes it to primary if it's the product's first approved image,
 * which the DB trigger then syncs into products.thumbnail_url).
 *
 * UI states this card has to render, in order of frequency:
 *
 *   cutout_approved  (the happy path)
 *      Big approved cutout. × button top-right = "I don't like this
 *      result" → markImageUnsatisfied → state=user_rejected, primary
 *      passes to the next approved image. Always has Delete.
 *
 *   cutout_failed    (rembg crashed / quota / provider down)
 *      Raw preview + Retry buttons (Replicate default; Remove.bg
 *      offered if configured). Reuses raw_image_url, no re-upload.
 *
 *   cutout_pending / cutout_rejected   (legacy — old uploads only)
 *      No inline actions here on the product workbench; operator
 *      should use the /admin/cutouts review queue if they need to
 *      approve / reject those manually.
 *
 *   user_rejected    (operator already × 'd this one)
 *      Shown for audit; only Delete.
 *
 *   raw              (transient — should never persist long enough
 *                     to render here unless the server crashed mid-
 *                     pipeline. Display "processing…" placeholder.)
 *
 * Server component: pure markup + server-action forms. State lives
 * in the DB; every mutation triggers revalidatePath on this route.
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
  /** Replicate OR Remove.bg env var present. When false the dropzone
   *  shows a sticky warning instead of letting the operator burn an
   *  upload that's guaranteed to land at cutout_failed. */
  hasAnyProvider: boolean;
  uploadedCount?: number;
  approvedCount?: number;
  failedCount?: number;
  deletedCount?: number;
  unsatisfied?: boolean;
  retried?: boolean;
  errCode?: string;
  errMsg?: string;
};

export default function ProductImagesSection({
  productId,
  images,
  canRerunRemoveBg,
  hasAnyProvider,
  uploadedCount,
  approvedCount,
  failedCount,
  deletedCount,
  unsatisfied,
  retried,
  errCode,
  errMsg,
}: Props) {
  const returnTo = `/admin/products/${productId}/edit`;
  const counts = images.reduce<Record<ImageState, number>>(
    (acc, i) => {
      acc[i.state] = (acc[i.state] ?? 0) + 1;
      return acc;
    },
    {
      raw: 0,
      cutout_pending: 0,
      cutout_approved: 0,
      cutout_rejected: 0,
      cutout_failed: 0,
      user_rejected: 0,
    },
  );

  const boundUpload = uploadRawImages.bind(null, productId);

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-5">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Images ({images.length})
        </h2>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-500">
          {(
            [
              "cutout_approved",
              "cutout_failed",
              "user_rejected",
              "cutout_pending",
              "cutout_rejected",
              "raw",
            ] as const
          ).map((s) =>
            counts[s] > 0 ? (
              <StatePill key={s} state={s} count={counts[s]} />
            ) : null,
          )}
        </div>
      </div>

      {/* Sticky warning when no rembg provider is configured. Sits
          ABOVE the action banners because it's a precondition the
          operator has to fix before uploads are useful — uploading
          without a provider lands every row at cutout_failed. */}
      {!hasAnyProvider && (
        <Banner tone="amber">
          <strong>No background-removal provider configured.</strong>{" "}
          Set <code>REPLICATE_API_TOKEN</code> (cheap, default) or{" "}
          <code>REMOVE_BG_API_KEY</code> in <code>.env.local</code> and
          restart the dev server. Without a provider every upload will
          land at <em>cutout_failed</em> and you&rsquo;ll have to retry.
        </Banner>
      )}

      {/* Banners — surface what just happened in plain language. The
          err banner is rose-tinted and includes both code + message
          (the message is the rembg / DB / quota cause string, often
          actionable). */}
      {errCode && (
        <Banner tone="rose">
          <strong>Upload error:</strong> {humanizeError(errCode)}
          {errMsg ? <> — {errMsg}</> : null}
        </Banner>
      )}
      {approvedCount && approvedCount > 0 ? (
        <Banner tone="emerald">
          {approvedCount === 1
            ? "Image uploaded and cutout approved automatically."
            : `${approvedCount} images uploaded and cutout-approved automatically.`}
          {approvedCount > 0 && images.some((i) => i.is_primary) && (
            <> Primary thumbnail is set.</>
          )}
        </Banner>
      ) : null}
      {failedCount && failedCount > 0 ? (
        <Banner tone="amber">
          {failedCount === 1
            ? "1 image failed background removal — click Retry on its card below."
            : `${failedCount} images failed background removal — click Retry on each card below.`}
        </Banner>
      ) : null}
      {uploadedCount && approvedCount === 0 && !errCode ? (
        <Banner tone="neutral">
          {uploadedCount === 1
            ? "Image uploaded."
            : `${uploadedCount} images uploaded.`}
        </Banner>
      ) : null}
      {deletedCount ? (
        <Banner tone="neutral">Image deleted.</Banner>
      ) : null}
      {unsatisfied ? (
        <Banner tone="neutral">Image marked as unsatisfactory.</Banner>
      ) : null}
      {retried ? (
        <Banner tone="emerald">Retry succeeded — cutout approved.</Banner>
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
            JPG / PNG / WebP · each ≤ 8 MB · Background removal runs
            automatically on upload (~$0.001/img via Replicate).
            Click × on an approved image to swap it for another.
          </p>
          <button
            type="submit"
            className="rounded-md bg-black px-4 py-1.5 text-xs font-medium text-white hover:bg-neutral-800"
          >
            Upload
          </button>
        </div>
      </form>

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
    image.cutout_image_url &&
    image.state !== "raw" &&
    image.state !== "cutout_failed";

  return (
    <div
      className={`relative rounded-md border p-2 text-xs ${
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
            className={`h-full w-full object-cover ${
              image.state === "cutout_failed" ? "opacity-60" : ""
            }`}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-neutral-400">
            {image.state === "raw" ? "Processing…" : "No preview"}
          </div>
        )}
        {image.is_primary && (
          <span className="absolute left-1.5 top-1.5 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-medium text-white shadow">
            Primary
          </span>
        )}
        {/* × top-right on approved images: mark as unsatisfactory.
            Floats over the thumbnail per the spec ("approved 是
            default, rejected 是 user exception"). */}
        {image.state === "cutout_approved" && (
          <UnsatisfiedButton imageId={image.id} returnTo={returnTo} />
        )}
        {image.state === "cutout_failed" && (
          <span className="absolute inset-x-0 bottom-0 bg-rose-600/90 px-2 py-1 text-center text-[10px] font-medium text-white">
            Cutout failed
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

      {/* state-specific inline actions — kept minimal. The happy path
          (cutout_approved) needs no buttons; the × on the thumbnail
          is the only interaction. Failures are recoverable via Retry. */}
      <div className="mt-2 space-y-1.5">
        {image.state === "cutout_failed" && (
          <>
            <ActionForm
              action={retryFailedImage}
              label="↻ Retry (Replicate)"
              variant="primary"
              imageId={image.id}
              productId={image.product_id}
              returnTo={returnTo}
              extraInputs={{ providerId: "replicate_rembg" }}
            />
            {canRerunRemoveBg && (
              <ActionForm
                action={retryFailedImage}
                label="↻ Retry on Remove.bg"
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

        {image.state === "raw" && (
          <p className="text-center text-[10px] text-neutral-400">
            Background removal in progress…
          </p>
        )}

        {/* Destructive: always available. Delegated to a client
            component that owns the confirm() dialog. Primary gets a
            sterner message because deleting primary auto-promotes
            another approved image (or wipes thumbnail_url if there
            isn't one). */}
        <DeleteImageButton
          imageId={image.id}
          returnTo={returnTo}
          isPrimary={image.is_primary}
        />
      </div>
    </div>
  );
}

/**
 * The × that floats over an approved cutout. Renders as its own
 * <form> because server actions need one. Sits absolutely-positioned
 * over the thumbnail.
 */
function UnsatisfiedButton({
  imageId,
  returnTo,
}: {
  imageId: string;
  returnTo: string;
}) {
  return (
    <form action={markImageUnsatisfied} className="absolute right-1.5 top-1.5">
      <input type="hidden" name="imageId" value={imageId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <button
        type="submit"
        title="Mark as unsatisfactory — pick another image as primary"
        aria-label="Mark image as unsatisfactory"
        className="flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-sm leading-none text-neutral-700 shadow-sm hover:bg-rose-600 hover:text-white"
      >
        ×
      </button>
    </form>
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
  variant: "primary" | "neutral";
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
    raw: { label: "Processing", cls: "bg-neutral-100 text-neutral-600" },
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
    cutout_failed: {
      label: "Failed",
      cls: "bg-rose-100 text-rose-700",
    },
    user_rejected: {
      label: "Unsatisfied",
      cls: "bg-neutral-200 text-neutral-700",
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
    cutout_failed: "bg-rose-100 text-rose-700",
    user_rejected: "bg-neutral-200 text-neutral-700",
  };
  const labels: Record<ImageState, string> = {
    raw: "processing",
    cutout_pending: "pending",
    cutout_approved: "approved",
    cutout_rejected: "rejected",
    cutout_failed: "failed",
    user_rejected: "unsatisfied",
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
  tone: "emerald" | "neutral" | "amber" | "rose";
  children: React.ReactNode;
}) {
  const cls = {
    emerald: "bg-emerald-50 text-emerald-700",
    neutral: "bg-neutral-50 text-neutral-700",
    amber: "bg-amber-50 text-amber-800",
    rose: "bg-rose-50 text-rose-700",
  }[tone];
  return (
    <div className={`mb-4 rounded-md ${cls} px-4 py-2 text-xs`}>
      {children}
    </div>
  );
}

/** Map opaque action error codes to operator-readable phrases. */
function humanizeError(code: string): string {
  switch (code) {
    case "no_files":
      return "No files were selected.";
    case "upload":
      return "Upload to storage failed.";
    case "db":
      return "Database error.";
    case "missing_raw":
      return "Raw image is missing — re-upload.";
    case "no_provider":
      return "No background-removal provider is configured.";
    case "quota":
      return "Daily background-removal quota reached — try again tomorrow or use Remove.bg.";
    case "rembg":
      return "Background removal failed.";
    case "wrong_state":
      return "Image is not in the expected state for this action.";
    case "not_found":
      return "Image not found.";
    case "missing_id":
      return "Internal error: missing image id.";
    default:
      return code;
  }
}
