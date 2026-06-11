import Link from "next/link";

import { requireAdmin } from "@/lib/auth/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service";

/** Wave 10 — bundles list page. Compact CRUD; per-row product count
 *  fetched via separate count read so the list stays cheap when the
 *  catalog grows. */
export default async function BundlesPage() {
  await requireAdmin();
  const supabase = createServiceRoleClient();

  const { data: bundles, error } = await supabase
    .from("bundles")
    .select("id, name, slug, credit_cost, status, created_at")
    .order("created_at", { ascending: false });
  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold">Bundles</h1>
        <p className="mt-2 text-sm text-rose-700">{error.message}</p>
      </div>
    );
  }

  // Per-bundle product counts via 1 grouped read — postgrest doesn't
  // do GROUP BY in selects, so we fetch (bundle_id, product_id) and
  // aggregate in JS. Wave 10 bundle counts are tiny.
  const bundleIds = (bundles ?? []).map((b) => b.id);
  const bp = bundleIds.length
    ? (
        await supabase
          .from("bundle_products")
          .select("bundle_id")
          .in("bundle_id", bundleIds)
      ).data ?? []
    : [];
  const countMap = new Map<string, number>();
  for (const row of bp) {
    countMap.set(row.bundle_id, (countMap.get(row.bundle_id) ?? 0) + 1);
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Bundles</h1>
          <p className="text-sm text-neutral-500">
            {bundles?.length ?? 0} total · curated product packs
          </p>
        </div>
        <Link
          href="/admin/bundles/new"
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          + New bundle
        </Link>
      </div>

      {(!bundles || bundles.length === 0) ? (
        <div className="rounded-md border border-dashed border-neutral-300 bg-neutral-50 p-8 text-center text-sm text-neutral-500">
          No bundles yet. Click <strong>+ New bundle</strong> to create
          one.
        </div>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Slug</th>
              <th className="px-3 py-2 text-right">Credit</th>
              <th className="px-3 py-2 text-right">Products</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Created</th>
            </tr>
          </thead>
          <tbody>
            {bundles.map((b) => (
              <tr
                key={b.id}
                className="border-b border-neutral-100 hover:bg-neutral-50"
              >
                <td className="px-3 py-2">
                  <Link
                    href={`/admin/bundles/${b.id}`}
                    className="text-sky-700 hover:underline"
                  >
                    {b.name}
                  </Link>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-neutral-500">
                  {b.slug}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {b.credit_cost}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {countMap.get(b.id) ?? 0}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={
                      b.status === "published"
                        ? "rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 ring-1 ring-emerald-200"
                        : "rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600"
                    }
                  >
                    {b.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-neutral-500">
                  {new Date(b.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
