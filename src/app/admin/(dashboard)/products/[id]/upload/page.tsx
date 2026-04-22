import Link from "next/link";
import { notFound } from "next/navigation";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getSignedRawUrl } from "@/lib/storage";
import { providerAvailability } from "@/lib/rembg";
import { todayUsageSummary } from "@/lib/api-usage";
import { UploadDropzone } from "@/components/admin/UploadDropzone";
import { uploadRawImages, processImage, processAllRaw } from "./actions";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    uploaded?: string;
    err?: string;
    msg?: string;
  }>;
};

export default async function UploadPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const sp = await searchParams;

  const supabase = createServiceRoleClient();
  const [{ data: product }, { data: images }, usage, avail] = await Promise.all(
    [
      supabase
        .from("products")
        .select("id,name,thumbnail_url")
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("product_images")
        .select("*")
        .eq("product_id", id)
        .order("created_at", { ascending: true }),
      todayUsageSummary(),
      Promise.resolve(providerAvailability()),
    ],
  );
  if (!product) notFound();

  // Replace raw (private) paths with short-lived signed URLs so the
  // operator can actually SEE what they uploaded in the review cards.
  const imagesWithPreviews = await Promise.all(
    (images ?? []).map(async (img) => ({
      ...img,
      raw_preview_url: img.raw_image_url
        ? await getSignedRawUrl(img.raw_image_url).catch(() => null)
        : null,
    })),
  );

  const rawCount = imagesWithPreviews.filter((i) => i.state === "raw").length;
  const pendingCount = imagesWithPreviews.filter(
    (i) => i.state === "cutout_pending",
  ).length;

  const bound = uploadRawImages.bind(null, id);
  const boundProcessAll = processAllRaw.bind(null, id);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <header className="flex items-start justify-between">
        <div>
          <div className="text-xs text-neutral-500">
            <Link href="/admin" className="hover:text-black">
              ← Products
            </Link>
            {" · "}
            <Link
              href={`/admin/products/${id}/edit`}
              className="hover:text-black"
            >
              Edit product
            </Link>
          </div>
          <h1 className="mt-2 text-2xl font-semibold">Upload images</h1>
          <div className="mt-1 text-sm text-neutral-600">
            {product.name}
          </div>
        </div>
        <Link
          href="/admin/cutouts"
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm hover:border-black"
        >
          Review queue →
        </Link>
      </header>

      {/* banners */}
      {sp.uploaded && (
        <div className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
          Uploaded {sp.uploaded} raw image(s). Click &ldquo;Cut out&rdquo; below to
          send each one to rembg.
        </div>
      )}
      {sp.err && (
        <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">
          {renderErr(sp.err, sp.msg)}
        </div>
      )}

      {/* quota card */}
      <QuotaCard usage={usage} avail={avail} />

      {/* uploader */}
      <section className="rounded-lg border border-neutral-200 bg-white p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Upload raw images (multi-select)
          </h2>
          {rawCount > 0 && (
            // Hoist the batch-process form OUT of the upload form. Two
            // server-action <form>s in one row is two distinct forms;
            // nesting them — as the previous version did — is invalid
            // HTML and confuses React's action dispatcher.
            <form action={boundProcessAll}>
              <button
                type="submit"
                className="rounded-md border border-neutral-300 px-4 py-2 text-sm hover:border-black"
                title={`Send all ${rawCount} raw images through rembg`}
              >
                Cut out all ({rawCount})
              </button>
            </form>
          )}
        </div>
        <form action={bound} className="space-y-3">
          {/* React 19 server actions auto-set encType for FormData with
              File entries — explicit encType="multipart/form-data" is
              ignored and warned about. The dropzone is a client
              component that owns the hidden file input. */}
          <UploadDropzone
            name="files"
            accept="image/jpeg,image/png,image/webp"
            multiple
          />
          <button
            type="submit"
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Upload
          </button>
        </form>
        <p className="mt-3 text-xs text-neutral-500">
          Tip: front-on product photos on a clean or white background work
          best. 1–4 MB per image is ideal. Cutout runs on Replicate
          (~$0.001/image); if a result looks bad, re-run it on Remove.bg
          from the review queue (~$0.20/image).
        </p>
      </section>

      {/* image list */}
      <section className="rounded-lg border border-neutral-200 bg-white p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Uploaded ({imagesWithPreviews.length})
          </h2>
          <div className="text-xs text-neutral-400">
            {rawCount > 0 && <>Raw {rawCount} · </>}
            {pendingCount > 0 && <>Pending {pendingCount}</>}
          </div>
        </div>
        {imagesWithPreviews.length === 0 ? (
          <p className="text-sm text-neutral-400">No images yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {imagesWithPreviews.map((img) => (
              <ImageCard
                key={img.id}
                productId={id}
                imageId={img.id}
                state={img.state}
                rawPreviewUrl={img.raw_preview_url}
                cutoutUrl={img.cutout_image_url}
                isPrimary={img.is_primary}
                provider={img.rembg_provider}
                costUsd={img.rembg_cost_usd}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function QuotaCard({
  usage,
  avail,
}: {
  usage: Awaited<ReturnType<typeof todayUsageSummary>>;
  avail: Record<"replicate_rembg" | "removebg", boolean>;
}) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
        Today&rsquo;s API usage
      </h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {(["replicate_rembg", "removebg", "meshy"] as const).map((s) => {
          const u = usage[s];
          const pct = u.limit > 0 ? Math.min(100, (u.count / u.limit) * 100) : 0;
          const configured =
            s === "meshy" ? Boolean(process.env.MESHY_API_KEY) : avail[s];
          return (
            <div
              key={s}
              className={`rounded-md border p-3 text-xs ${
                u.blocked
                  ? "border-rose-300 bg-rose-50"
                  : "border-neutral-200 bg-neutral-50"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-neutral-700">
                  {PROVIDER_LABELS[s]}
                </span>
                {!configured && (
                  <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-600">
                    Not configured
                  </span>
                )}
                {u.blocked && (
                  <span className="rounded bg-rose-200 px-1.5 py-0.5 text-[10px] text-rose-800">
                    Blocked
                  </span>
                )}
              </div>
              <div className="mt-1 text-neutral-500">
                {u.count} / {u.limit} calls · ${u.spentUsd.toFixed(3)}
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-200">
                <div
                  className={`h-full ${
                    u.blocked ? "bg-rose-500" : "bg-neutral-700"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

const PROVIDER_LABELS = {
  replicate_rembg: "Replicate rembg",
  removebg: "Remove.bg",
  meshy: "Meshy 3D (Stage B)",
} as const;

async function ImageCardProcess(fd: FormData) {
  "use server";
  const productId = fd.get("productId")?.toString() ?? "";
  const imageId = fd.get("imageId")?.toString() ?? "";
  await processImage(productId, imageId);
}

function ImageCard({
  productId,
  imageId,
  state,
  rawPreviewUrl,
  cutoutUrl,
  isPrimary,
  provider,
  costUsd,
}: {
  productId: string;
  imageId: string;
  state: string;
  rawPreviewUrl: string | null;
  cutoutUrl: string | null;
  isPrimary: boolean;
  provider: string | null;
  costUsd: number | null;
}) {
  const showCutout = cutoutUrl && state !== "raw";
  return (
    <div className="rounded-md border border-neutral-200 p-2 text-xs">
      <div className="aspect-square overflow-hidden rounded bg-neutral-50">
        {showCutout ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cutoutUrl!}
            alt=""
            className="h-full w-full object-contain"
          />
        ) : rawPreviewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={rawPreviewUrl}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-neutral-400">
            No preview
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <StateTag state={state} />
        {isPrimary && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">
            Primary
          </span>
        )}
      </div>
      {provider && (
        <div className="mt-1 text-neutral-500">
          {provider} · ${(costUsd ?? 0).toFixed(3)}
        </div>
      )}
      {state === "raw" && (
        <form action={ImageCardProcess} className="mt-2">
          <input type="hidden" name="productId" value={productId} />
          <input type="hidden" name="imageId" value={imageId} />
          <button
            type="submit"
            className="w-full rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800"
          >
            Cut out
          </button>
        </form>
      )}
      {state === "cutout_pending" && (
        <Link
          href="/admin/cutouts"
          className="mt-2 block rounded-md border border-neutral-300 px-3 py-1.5 text-center text-xs hover:border-black"
        >
          Review →
        </Link>
      )}
    </div>
  );
}

function StateTag({ state }: { state: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    raw: {
      label: "Raw",
      cls: "bg-neutral-100 text-neutral-600",
    },
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
  const m = map[state] ?? { label: state, cls: "bg-neutral-100 text-neutral-600" };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] ${m.cls}`}>
      {m.label}
    </span>
  );
}

function renderErr(err: string, msg?: string): string {
  switch (err) {
    case "no_files":
      return "Pick at least one file before clicking Upload.";
    case "upload":
      return `Upload failed: ${msg ?? "unknown"}`;
    case "db":
      return `Database error: ${msg ?? "unknown"}`;
    case "missing_raw":
      return "This image has no raw path — it may have been deleted. Refresh and try again.";
    case "no_provider":
      return `No rembg provider configured: set REPLICATE_API_TOKEN or REMOVEBG_API_KEY in Vercel. ${msg ?? ""}`;
    case "quota":
      return `Daily quota exhausted or emergency stop: ${msg ?? ""}`;
    case "rembg":
      return `Rembg failed: ${msg ?? ""}`;
    default:
      return `Error: ${err}`;
  }
}
