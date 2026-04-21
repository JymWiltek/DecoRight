import Link from "next/link";
import { listAllProducts } from "@/lib/admin/products";
import { formatMYR } from "@/lib/format";
import { loadTaxonomy, labelMap } from "@/lib/taxonomy";
import { PRODUCT_STATUS_LABELS } from "@/lib/constants/enum-labels";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-neutral-100 text-neutral-700",
  published: "bg-emerald-100 text-emerald-700",
  archived: "bg-amber-100 text-amber-800",
  link_broken: "bg-red-100 text-red-700",
};

export default async function AdminProductsPage() {
  const [products, taxonomy] = await Promise.all([
    listAllProducts(),
    loadTaxonomy(),
  ]);
  const itemTypeLabels = labelMap(taxonomy.itemTypes);

  const byStatus = products.reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">商品管理</h1>
          <p className="mt-1 text-sm text-neutral-500">
            共 {products.length} 件
            {(["published", "draft", "archived", "link_broken"] as const)
              .filter((s) => byStatus[s])
              .map((s) => ` · ${PRODUCT_STATUS_LABELS[s]} ${byStatus[s]}`)
              .join("")}
          </p>
        </div>
        <Link
          href="/admin/products/new"
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          + 新增商品
        </Link>
      </div>

      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-4 py-3">商品</th>
              <th className="px-4 py-3">物件</th>
              <th className="px-4 py-3">价格</th>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3">3D</th>
              <th className="px-4 py-3">更新时间</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} className="border-b border-neutral-100 last:border-0">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 overflow-hidden rounded bg-neutral-100">
                      {p.thumbnail_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.thumbnail_url}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      )}
                    </div>
                    <div>
                      <div className="font-medium text-neutral-900">{p.name}</div>
                      <div className="text-xs text-neutral-500">{p.brand ?? "—"}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-neutral-700">
                  {p.item_type ? (itemTypeLabels[p.item_type] ?? p.item_type) : "—"}
                </td>
                <td className="px-4 py-3 text-neutral-700">
                  {formatMYR(p.price_myr)}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLES[p.status]}`}
                  >
                    {PRODUCT_STATUS_LABELS[p.status]}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-neutral-500">
                  {p.glb_url ? `${p.glb_size_kb ?? "?"} KB` : "—"}
                </td>
                <td className="px-4 py-3 text-xs text-neutral-500">
                  {new Date(p.updated_at).toLocaleString("zh-CN")}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/admin/products/${p.id}/edit`}
                    className="text-sm text-neutral-700 hover:text-black"
                  >
                    编辑
                  </Link>
                </td>
              </tr>
            ))}
            {products.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-sm text-neutral-500">
                  还没有商品，点击右上角新增。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
