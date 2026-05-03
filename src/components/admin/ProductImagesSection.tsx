import { UploadDropzone } from "./UploadDropzone";
import DeleteImageButton from "./DeleteImageButton";
import RunRembgButton from "./RunRembgButton";
import {
  markImageSkipCutout,
  markImageUnsatisfied,
  retryFailedImage,
} from "@/app/admin/(dashboard)/products/[id]/edit/image-actions";
import type { ImageErrorKind, ImageState } from "@/lib/supabase/types";
import type { ProductRembgUsage } from "@/lib/admin/products";

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
  /** Phase 1 收尾 P0-2: categorized failure reason. Populated by
   *  pipeline.ts whenever a row lands at cutout_failed. Wired through
   *  here so commit 2 can render a specific sentence per category. */
  last_error_kind: ImageErrorKind | null;
  /** Migration 0027: true when the operator clicked "Skip — already
   *  clean" on a raw row, in which case the row landed at
   *  cutout_approved with cutout_image_url pointing at a copy of the
   *  raw bytes in the public cutouts bucket. Drives the "skipped"
   *  badge on the approved card and the $0-spend cost line. */
  skip_cutout: boolean;
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
  /** Migration 0027 — set to true when the redirect query carries
   *  `?skipped=1`, i.e. the operator just marked an image as "Skip —
   *  already clean". Drives the success banner. */
  skipped?: boolean;
  errCode?: string;
  errMsg?: string;
  /** P0-3: lifetime rembg cost rollup. Lets the section header show
   *  a product-wide total and each card a per-image attempt count
   *  instead of just the most-recent attempt's cost. */
  rembgUsage?: ProductRembgUsage;
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
  skipped,
  errCode,
  errMsg,
  rembgUsage,
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

      {/* P0-3: lifetime rembg spend — sums all replicate / removebg
          api_usage rows for this product. Refunded attempts already
          net to zero in the source, so this is "money actually spent
          on this product's photos" and not a gross-of-refunds figure.
          Only render once we have at least one positive-cost attempt;
          otherwise it'd be a noisy "$0.00 across 0 attempts" line on
          every fresh draft. */}
      {rembgUsage && rembgUsage.productAttempts > 0 && (
        <div className="mb-4 rounded-md bg-neutral-50 px-3 py-2 text-[11px] text-neutral-600">
          <strong className="text-neutral-700">rembg spend:</strong>{" "}
          ${rembgUsage.productSpentUsd.toFixed(3)}
          {" · "}
          {rembgUsage.productAttempts}{" "}
          {rembgUsage.productAttempts === 1 ? "attempt" : "attempts"}
          {/* Add "on N images" only when attempts ≠ image count —
              otherwise redundant ("3 attempts on 3 images") since
              that's the 1:1 happy path. The diff signal is "this
              product had retries somewhere". */}
          {Object.keys(rembgUsage.perImage).length > 0 &&
            Object.keys(rembgUsage.perImage).length !==
              rembgUsage.productAttempts && (
              <>
                {" "}on {Object.keys(rembgUsage.perImage).length}{" "}
                {Object.keys(rembgUsage.perImage).length === 1
                  ? "image"
                  : "images"}
              </>
            )}
          .
        </div>
      )}

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

      {/* Wave 2A · Commit 5: standalone "Run Background Removal"
          surface. Hidden when nothing is pending; shows a determinate
          progress banner while running; shows a result banner after.
          Replaces the implicit "Save will rembg this for you"
          behavior — operator now decides explicitly when to spend
          rembg quota. */}
      <RunRembgButton
        productId={productId}
        initial={{
          raw: counts.raw,
          cutout_failed: counts.cutout_failed,
          cutout_approved: counts.cutout_approved,
          cutout_pending: counts.cutout_pending,
        }}
        hasAnyProvider={hasAnyProvider}
      />

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
      {skipped ? (
        <Banner tone="emerald">
          Image marked as already clean — saved to gallery without running
          background removal.
        </Banner>
      ) : null}

      {/* Uploader: pure-preview dropzone. Files stage as thumbnails
          in React state; nothing touches Storage until the operator
          clicks Save / Publish on ProductForm above (that form owns
          the submit lifecycle and iterates registered uploaders).
          rembg spend is gated on final product status=published. */}
      <UploadDropzone
        productId={productId}
        accept="image/jpeg,image/png,image/webp"
        multiple
        maxFileMb={8}
      />

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
              usage={rembgUsage?.perImage[img.id]}
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
  usage,
}: {
  image: ImageWithPreview;
  returnTo: string;
  canRerunRemoveBg: boolean;
  /** Lifetime rembg cost for THIS image. Undefined for rows that
   *  never went through the pipeline (just-uploaded raw). */
  usage?: { spentUsd: number; attempts: number };
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
        {/* Mig 0027 · "skipped" badge — distinguishes a cutout that's
            actually a verbatim raw copy (skip_cutout=true, $0 spend)
            from a real rembg output. Sits below the Primary chip
            (top:7 = ~28px vertical offset) so they stack cleanly when
            an image is BOTH primary AND skipped (the common case for
            single-image products). */}
        {image.skip_cutout && image.state === "cutout_approved" && (
          <span
            className={`absolute ${image.is_primary ? "left-1.5 top-7" : "left-1.5 top-1.5"} rounded bg-sky-600 px-1.5 py-0.5 text-[10px] font-medium text-white shadow`}
            title="Operator skipped background removal — using the original photo as-is."
          >
            Skipped
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
        {/* P0-3: lifetime cost + attempt count (from api_usage rollup)
            replaces the legacy "last attempt cost" rendering. Falls
            back to per-row rembg_cost_usd when the api_usage path
            hasn't been wired (older rows pre-migration 0006 had no
            product_image_id linkage; harmless because those don't
            roll up into `usage` either). */}
        {usage && usage.attempts > 0 ? (
          <span
            className="text-[10px] text-neutral-500"
            title={
              image.rembg_provider
                ? `last attempt via ${image.rembg_provider}`
                : undefined
            }
          >
            ${usage.spentUsd.toFixed(3)} ·{" "}
            {usage.attempts === 1
              ? "1 attempt"
              : `${usage.attempts} attempts`}
          </span>
        ) : (
          image.rembg_provider && (
            <span className="text-[10px] text-neutral-500">
              {image.rembg_provider}
              {image.rembg_cost_usd != null && (
                <> · ${image.rembg_cost_usd.toFixed(3)}</>
              )}
            </span>
          )
        )}
      </div>

      {/* state-specific inline actions — kept minimal. The happy path
          (cutout_approved) needs no buttons; the × on the thumbnail
          is the only interaction. Failures are recoverable via Retry. */}
      <div className="mt-2 space-y-1.5">
        {image.state === "cutout_failed" && (
          <>
            {/* Categorized failure sentence (P0-2 commit 2). Sits
                above the Retry buttons so the operator reads the
                reason BEFORE deciding whether retry will help — e.g.
                no_provider can't be fixed by retrying, image_too_large
                requires re-exporting locally first. */}
            <p className="rounded bg-rose-50 px-2 py-1 text-[11px] leading-snug text-rose-700">
              {errorMessageFor(image.last_error_kind)}
            </p>
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
          <>
            <p className="text-center text-[10px] text-neutral-400">
              Background removal in progress…
            </p>
            {/* Mig 0027 · skip-cutout escape hatch. The `raw` state is
                normally transient — the auto-pipeline runs rembg in
                the same server action that uploads the bytes. But
                when rembg fails partway, or when the operator's photo
                is already clean (white backdrop, reflective surface,
                wood grain that rembg destroys), they can click Skip
                here to copy the raw bytes into the public cutouts
                bucket as-is and unblock Publish without burning rembg
                quota. The button title spells out the trade-off so
                we don't lure operators into skipping busy backdrops. */}
            <ActionForm
              action={markImageSkipCutout}
              label="Skip — already clean"
              variant="neutral"
              imageId={image.id}
              productId={image.product_id}
              returnTo={returnTo}
              title="Use this photo as-is — don't run background removal."
            />
          </>
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

/** Phase 1 收尾 P0-2 commit 2: human-readable sentence for the four
 *  failure categories pipeline.ts can emit. Shown beneath the failed
 *  thumbnail so the operator's next action is unambiguous —
 *  "Provider not configured" (env issue, ping admin) is very different
 *  from "Provider error" (transient, retry) and from "Image too large"
 *  (operator action: re-export at smaller dimensions).
 *
 *  Fallback for null kind covers two cases:
 *   1) Pre-migration-0019 cutout_failed rows that never carried a kind.
 *   2) Race where state flipped to cutout_failed but the kind write
 *      lost the round-trip (would be a pipeline bug — but we'd rather
 *      show "Try again" than crash on a missing key).
 *
 *  Module-level so commit 3 (cost section) can reuse it for tooltips
 *  if we surface aggregated last_error_kind there. */
function errorMessageFor(kind: ImageErrorKind | null): string {
  switch (kind) {
    case "no_provider":
      return "Provider not configured. Check Vercel env vars.";
    case "quota_exhausted":
      return "Provider quota exhausted. Wait or upgrade plan.";
    case "provider_error":
      return "Provider error. Try again in a moment.";
    case "image_too_large":
      return "Image too large. Max 8 MB per file.";
    case null:
    default:
      return "Background removal failed. Try again.";
  }
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

/** Map opaque action error codes to operator-readable phrases. The
 *  rembg-failure subset (no_provider / quota / rembg) intentionally
 *  uses the SAME copy as `errorMessageFor` above so the per-image
 *  inline sentence and the section banner read identically. Don't let
 *  these drift — change both or neither. The quota+rembg synonyms
 *  here match `quota_exhausted` and `provider_error` respectively
 *  (URL codes are still the legacy short forms, see flattenRembgError). */
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
      return "Provider not configured. Check Vercel env vars.";
    case "quota":
      return "Provider quota exhausted. Wait or upgrade plan.";
    case "rembg":
      return "Provider error. Try again in a moment.";
    case "image_too_large":
      return "Image too large. Max 8 MB per file.";
    case "wrong_state":
      return "Image is not in the expected state for this action.";
    case "not_found":
      return "Image not found.";
    case "missing_id":
      return "Internal error: missing image id.";
    case "storage":
      // Mig 0027 · markImageSkipCutout copy step failed (raw download
      // or cutouts upload). Operator can retry; the row is still raw.
      return "Storage error copying the raw image — try again.";
    case "product_mismatch":
      // Mig 0027 · belt-and-suspenders cross-product guard.
      return "Image does not belong to this product.";
    default:
      return code;
  }
}
