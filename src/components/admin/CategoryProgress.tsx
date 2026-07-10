import Link from "next/link";
import {
  getCategoryProgress,
  ITEM_TYPE_NONE,
} from "@/lib/admin/products";
import { loadTaxonomy, labelMap } from "@/lib/taxonomy";

/**
 * Admin-home upload-progress overview (Task 1). A responsive grid of
 * clickable category cards — each shows published count, draft count, and
 * 3D / scene-cover coverage, and links to that category's filtered product
 * list (`/admin?type=<slug>`) so the operator can drill "which are up vs
 * which aren't". Mobile-first (2 cols on phones). Server component; data is
 * live per request.
 */
export default async function CategoryProgress() {
  const [rows, taxonomy] = await Promise.all([
    getCategoryProgress(),
    loadTaxonomy(),
  ]);
  const labels = labelMap(taxonomy.itemTypes, "en");
  const totalPub = rows.reduce((a, r) => a + r.published, 0);
  const totalDraft = rows.reduce((a, r) => a + r.draft, 0);

  return (
    <section className="mb-6">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-neutral-800">
          品类进度 · Category progress
        </h2>
        <span className="text-xs text-neutral-500">
          已发布 <b className="text-emerald-700">{totalPub}</b> · 草稿{" "}
          <b className="text-amber-700">{totalDraft}</b> · 目标 500
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {rows.map((r) => {
          const label =
            r.slug === ITEM_TYPE_NONE
              ? "(untyped)"
              : (labels[r.slug] ?? r.slug);
          const pct = r.total ? Math.round((r.published / r.total) * 100) : 0;
          return (
            <Link
              key={r.slug}
              href={`/admin?type=${encodeURIComponent(r.slug)}`}
              className="rounded-lg border border-neutral-200 bg-white p-3 transition hover:border-neutral-400 hover:shadow-sm"
            >
              <div className="truncate text-sm font-medium text-neutral-900">
                {label}
              </div>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-2xl font-semibold tabular-nums text-emerald-700">
                  {r.published}
                </span>
                <span className="text-[11px] text-neutral-400">已发布</span>
                {r.draft > 0 && (
                  <span className="ml-auto rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                    {r.draft} draft
                  </span>
                )}
              </div>
              <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-neutral-100">
                <div
                  className="h-full rounded-full bg-emerald-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="mt-1.5 flex gap-2 text-[11px] text-neutral-500">
                <span>
                  3D {r.with3d}/{r.total}
                </span>
                <span>
                  场景 {r.withScene}/{r.total}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
