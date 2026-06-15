import "server-only";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { SUPPLIER_TYPE_LABELS } from "@/lib/constants/enum-labels";
import type { SupplierRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

/**
 * Mig 0048 — supplier admin list. Mirrors the designers/bundles list:
 * fetch the base table fresh (service role), count product links per
 * supplier in JS, render a table with a "New supplier" CTA.
 */
export default async function SuppliersPage({
  searchParams,
}: {
  searchParams?: Promise<{ deleted?: string }>;
}) {
  await requireAdmin();
  const sp = (await searchParams) ?? {};
  const supabase = createServiceRoleClient();
  const [{ data: suppliers }, { data: links }] = await Promise.all([
    supabase.from("suppliers").select("*").order("name", { ascending: true }),
    supabase.from("product_suppliers").select("supplier_id"),
  ]);
  const countBySupplier = new Map<string, number>();
  for (const l of links ?? [])
    countBySupplier.set(l.supplier_id, (countBySupplier.get(l.supplier_id) ?? 0) + 1);
  const rows = (suppliers ?? []) as SupplierRow[];

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Suppliers</h1>
        <Link
          href="/admin/suppliers/new"
          className="rounded-md bg-black px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
        >
          + New supplier
        </Link>
      </div>
      {sp.deleted && (
        <div className="mb-3 rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Supplier deleted.
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
          No suppliers yet. Click “New supplier” to add the first retailer.
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-neutral-200">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Covered states</th>
                <th className="px-4 py-2">Products</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-neutral-100 hover:bg-neutral-50"
                >
                  <td className="px-4 py-2">
                    <Link
                      href={`/admin/suppliers/${r.id}`}
                      className="font-medium text-sky-700 hover:underline"
                    >
                      {r.name}
                    </Link>
                    {r.whatsapp && (
                      <span className="ml-2 text-xs text-neutral-400">
                        wa: {r.whatsapp}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700">
                      {SUPPLIER_TYPE_LABELS[r.type]}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-neutral-500">
                    {r.region_slugs.length
                      ? `${r.region_slugs.length} state${r.region_slugs.length === 1 ? "" : "s"}`
                      : "—"}
                  </td>
                  <td className="px-4 py-2 text-neutral-600">
                    {countBySupplier.get(r.id) ?? 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
