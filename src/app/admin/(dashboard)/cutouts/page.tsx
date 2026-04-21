import Link from "next/link";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { providerAvailability } from "@/lib/rembg";
import type { ImageState } from "@/lib/supabase/types";
import { approveCutout, rejectCutout, setPrimary } from "./actions";

export const dynamic = "force-dynamic";

type SearchParams = {
  approved?: string;
  rejected?: string;
  reran?: string;
  primary?: string;
  err?: string;
  msg?: string;
  tab?: string;
};

type PageProps = { searchParams: Promise<SearchParams> };

export default async function CutoutsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const tab = sp.tab === "all" ? "all" : "pending";

  const supabase = createServiceRoleClient();
  const avail = providerAvailability();

  // Pull all images in review-relevant states, joined to product name.
  // We don't use a foreign-key embed because supabase-js PostgREST
  // relationships need explicit FK metadata; a manual two-query join
  // is simpler and still fast.
  const stateFilter: ImageState[] =
    tab === "pending"
      ? ["cutout_pending"]
      : ["cutout_pending", "cutout_approved", "cutout_rejected"];

  const { data: images, error } = await supabase
    .from("product_images")
    .select("*")
    .in("state", stateFilter)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const productIds = Array.from(
    new Set((images ?? []).map((i) => i.product_id)),
  );
  const { data: products } = productIds.length
    ? await supabase
        .from("products")
        .select("id,name,brand")
        .in("id", productIds)
    : { data: [] as { id: string; name: string; brand: string | null }[] };
  const productMap = new Map(
    (products ?? []).map((p) => [p.id, p] as const),
  );

  const pendingCount = (images ?? []).filter(
    (i) => i.state === "cutout_pending",
  ).length;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold">抠图审核</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Replicate 跑完的抠图在这里过人工。通过就进产品主图；拒绝可以用
          Remove.bg 重抠（贵但更干净）。
        </p>
      </header>

      {/* banners */}
      {sp.approved && (
        <Banner tone="emerald">已通过，商品主图已自动更新。</Banner>
      )}
      {sp.rejected && <Banner tone="amber">已拒绝这张抠图。</Banner>}
      {sp.reran && (
        <Banner tone="sky">
          已用 Remove.bg 重抠，新结果回到「待审核」列表。
        </Banner>
      )}
      {sp.primary && <Banner tone="emerald">已切换主图。</Banner>}
      {sp.err && (
        <Banner tone="rose">
          出错了：{sp.err}
          {sp.msg ? ` — ${sp.msg}` : ""}
        </Banner>
      )}

      {/* tabs */}
      <div className="flex items-center gap-2 text-sm">
        <Link
          href="/admin/cutouts"
          className={`rounded-md px-3 py-1.5 ${
            tab === "pending"
              ? "bg-black text-white"
              : "border border-neutral-300 hover:border-black"
          }`}
        >
          待审核 ({pendingCount})
        </Link>
        <Link
          href="/admin/cutouts?tab=all"
          className={`rounded-md px-3 py-1.5 ${
            tab === "all"
              ? "bg-black text-white"
              : "border border-neutral-300 hover:border-black"
          }`}
        >
          全部
        </Link>
      </div>

      {/* list */}
      {(images ?? []).length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-12 text-center text-sm text-neutral-500">
          {tab === "pending"
            ? "空闲中 · 没有待审核的抠图。"
            : "还没有抠图。去商品详情页上传。"}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(images ?? []).map((img) => (
            <ReviewCard
              key={img.id}
              imageId={img.id}
              productId={img.product_id}
              productName={productMap.get(img.product_id)?.name ?? "—"}
              brand={productMap.get(img.product_id)?.brand ?? null}
              cutoutUrl={img.cutout_image_url}
              state={img.state}
              isPrimary={img.is_primary}
              provider={img.rembg_provider}
              costUsd={img.rembg_cost_usd}
              createdAt={img.created_at}
              canRerunRemoveBg={avail.removebg}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "emerald" | "amber" | "rose" | "sky";
  children: React.ReactNode;
}) {
  const cls = {
    emerald: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-800",
    rose: "bg-rose-50 text-rose-700",
    sky: "bg-sky-50 text-sky-700",
  }[tone];
  return <div className={`rounded-md ${cls} px-4 py-2 text-sm`}>{children}</div>;
}

function ReviewCard({
  imageId,
  productId,
  productName,
  brand,
  cutoutUrl,
  state,
  isPrimary,
  provider,
  costUsd,
  createdAt,
  canRerunRemoveBg,
}: {
  imageId: string;
  productId: string;
  productName: string;
  brand: string | null;
  cutoutUrl: string | null;
  state: string;
  isPrimary: boolean;
  provider: string | null;
  costUsd: number | null;
  createdAt: string;
  canRerunRemoveBg: boolean;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="aspect-square overflow-hidden rounded bg-neutral-50">
        {cutoutUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cutoutUrl}
            alt=""
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-neutral-400">
            （无抠图预览）
          </div>
        )}
      </div>
      <div className="mt-3">
        <div className="flex items-center justify-between">
          <Link
            href={`/admin/products/${productId}/edit`}
            className="truncate text-sm font-medium hover:underline"
          >
            {productName}
          </Link>
          {isPrimary && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">
              主图
            </span>
          )}
        </div>
        {brand && <div className="text-xs text-neutral-500">{brand}</div>}
        <div className="mt-1 text-xs text-neutral-500">
          {provider ?? "—"}
          {costUsd != null && <> · ${costUsd.toFixed(3)}</>}
          {" · "}
          {new Date(createdAt).toLocaleString("zh-CN")}
        </div>
      </div>

      {state === "cutout_pending" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <form action={approveCutout}>
            <input type="hidden" name="imageId" value={imageId} />
            <button
              type="submit"
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
            >
              ✓ 通过
            </button>
          </form>
          <form action={rejectCutout}>
            <input type="hidden" name="imageId" value={imageId} />
            <button
              type="submit"
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:border-rose-500 hover:text-rose-600"
            >
              × 拒绝
            </button>
          </form>
          {canRerunRemoveBg && (
            <form action={rejectCutout}>
              <input type="hidden" name="imageId" value={imageId} />
              <input type="hidden" name="rerun" value="removebg" />
              <button
                type="submit"
                className="rounded-md border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs text-sky-700 hover:bg-sky-100"
                title="用 Remove.bg 重新抠一次（约 $0.20）"
              >
                用 Remove.bg 重抠 →
              </button>
            </form>
          )}
        </div>
      )}

      {state === "cutout_approved" && !isPrimary && (
        <div className="mt-3">
          <form action={setPrimary}>
            <input type="hidden" name="imageId" value={imageId} />
            <button
              type="submit"
              className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:border-black"
            >
              设为主图
            </button>
          </form>
        </div>
      )}

      <div className="mt-2 flex items-center justify-between text-[11px] text-neutral-400">
        <StateChip state={state} />
        <Link
          href={`/admin/products/${productId}/upload`}
          className="hover:text-black"
        >
          在产品页看 →
        </Link>
      </div>
    </div>
  );
}

function StateChip({ state }: { state: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    cutout_pending: { label: "待审核", cls: "bg-amber-100 text-amber-800" },
    cutout_approved: {
      label: "已通过",
      cls: "bg-emerald-100 text-emerald-800",
    },
    cutout_rejected: { label: "已拒", cls: "bg-rose-100 text-rose-700" },
    raw: { label: "原图", cls: "bg-neutral-100 text-neutral-600" },
  };
  const m = map[state] ?? { label: state, cls: "bg-neutral-100 text-neutral-600" };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] ${m.cls}`}>
      {m.label}
    </span>
  );
}
