import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-admin";
import { loadTaxonomy } from "@/lib/taxonomy";
import SupplierForm from "@/components/admin/SupplierForm";
import { createSupplierAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewSupplierPage({
  searchParams,
}: {
  searchParams?: Promise<{ err?: string; msg?: string }>;
}) {
  await requireAdmin();
  const sp = (await searchParams) ?? {};
  const taxonomy = await loadTaxonomy();
  const regions = [...taxonomy.regions].sort(
    (a, b) => a.sort_order - b.sort_order,
  );

  return (
    <div className="mx-auto max-w-xl p-6">
      <div className="mb-4">
        <Link
          href="/admin/suppliers"
          className="text-sm text-sky-700 hover:underline"
        >
          ← Suppliers
        </Link>
      </div>
      <h1 className="text-xl font-semibold">New supplier</h1>
      <p className="mt-1 text-sm text-neutral-500">
        A retailer / dealer / official store that sells these products. Link
        it to products from the product edit page.
      </p>
      {sp.err && (
        <div className="mt-3 rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <strong>{sp.err}</strong>: {sp.msg ?? ""}
        </div>
      )}
      <div className="mt-6">
        <SupplierForm action={createSupplierAction} regions={regions} />
      </div>
    </div>
  );
}
