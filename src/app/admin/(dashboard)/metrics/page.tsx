import "server-only";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { loadTaxonomy, labelFor } from "@/lib/taxonomy";
import { getLocale } from "next-intl/server";
import type { Locale } from "@/i18n/config";

export const dynamic = "force-dynamic";

/**
 * Category Asset Metrics — monetization dashboard. Live from the DB (no
 * hardcoded numbers): per published category, the product count + how many
 * have a 3D model + how many have an operator-uploaded real photo (the
 * asset-quality signals used when negotiating with brands/designers).
 *
 * "Has real photo" = ≥1 storefront image with image_kind='real_photo'
 * (a deliberately-uploaded photograph, as opposed to an auto rembg cutout).
 * It's the queryable proxy for "has a scene/lifestyle cover"; the exact
 * scene-vs-white-bg split needs per-image analysis (the storefront
 * scene-image project) and cross-checks against this number.
 *
 * Mobile-first: stat cards + a stacked category list (no wide table).
 */
export default async function MetricsPage() {
  await requireAdmin();
  const supabase = createServiceRoleClient();
  const [{ data: products }, { data: realPhotos }, taxonomy, locale] =
    await Promise.all([
      supabase.from("products").select("id,item_type,status,glb_url,glb_compressed_url"),
      supabase
        .from("product_images")
        .select("product_id")
        .eq("image_kind", "real_photo")
        .eq("show_on_storefront", true),
      loadTaxonomy(),
      getLocale() as Promise<Locale>,
    ]);

  const rpSet = new Set((realPhotos ?? []).map((r) => r.product_id));
  const all = products ?? [];
  const pub = all.filter((p) => p.status === "published");
  const drafts = all.filter((p) => p.status !== "published");
  const has3d = (p: (typeof all)[number]) =>
    Boolean(p.glb_url || p.glb_compressed_url);

  type Row = { slug: string; n: number; d3: number; rp: number };
  const byCat = new Map<string, Row>();
  for (const p of pub) {
    const it = p.item_type ?? "(未分类)";
    const r =
      byCat.get(it) ?? byCat.set(it, { slug: it, n: 0, d3: 0, rp: 0 }).get(it)!;
    r.n++;
    if (has3d(p)) r.d3++;
    if (rpSet.has(p.id)) r.rp++;
  }
  const rows = [...byCat.values()].sort((a, b) => b.n - a.n);

  const labelMap = new Map(
    taxonomy.itemTypes.map((t) => [t.slug, labelFor(t, locale)]),
  );
  const total = pub.length;
  const total3d = pub.filter(has3d).length;
  const totalRp = pub.filter((p) => rpSet.has(p.id)).length;
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <h1 className="text-xl font-semibold text-neutral-900">品类资产指标</h1>
      <p className="mt-1 text-xs text-neutral-500">
        Category Asset Metrics · 实时数据 · 按已发布产品数排序
      </p>

      {/* Totals */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="已发布产品" value={total} />
        <Stat label="有 3D 模型" value={total3d} sub={`${pct(total3d, total)}%`} />
        <Stat label="有真实照片" value={totalRp} sub={`${pct(totalRp, total)}%`} />
        <Stat label="Draft 未发布" value={drafts.length} tone="muted" />
      </div>

      {/* Per-category */}
      <div className="mt-6 space-y-2">
        {rows.map((r) => (
          <div
            key={r.slug}
            className="rounded-lg border border-neutral-200 bg-white p-3"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-medium text-neutral-900">
                  {labelMap.get(r.slug) ?? r.slug}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-neutral-500">
                  <span>
                    3D <span className="font-medium text-neutral-700">{r.d3}</span>
                    <span className="text-neutral-400"> ({pct(r.d3, r.n)}%)</span>
                  </span>
                  <span>
                    真实照片{" "}
                    <span className="font-medium text-neutral-700">{r.rp}</span>
                    <span className="text-neutral-400"> ({pct(r.rp, r.n)}%)</span>
                  </span>
                </div>
              </div>
              <div className="shrink-0 text-3xl font-semibold tabular-nums text-neutral-900">
                {r.n}
              </div>
            </div>
            {/* 3D coverage bar */}
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
              <div
                className="h-full rounded-full bg-emerald-500"
                style={{ width: `${pct(r.d3, r.n)}%` }}
              />
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <div className="rounded-md border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
            还没有已发布产品。
          </div>
        )}
      </div>

      <p className="mt-6 text-[11px] leading-relaxed text-neutral-400">
        「有真实照片」= 有 ≥1 张运营上传的真实照片(image_kind=real_photo,非自动抠图),
        作为「有场景封面」的近似指标;精确的「场景图 vs 白底图」拆分需逐图分析(见情景图项目)。
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: number;
  sub?: string;
  tone?: "muted";
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        tone === "muted"
          ? "border-neutral-200 bg-neutral-50"
          : "border-neutral-200 bg-white"
      }`}
    >
      <div className="text-2xl font-semibold tabular-nums text-neutral-900">
        {value}
        {sub && (
          <span className="ml-1 text-sm font-normal text-neutral-400">{sub}</span>
        )}
      </div>
      <div className="mt-0.5 text-xs text-neutral-500">{label}</div>
    </div>
  );
}
