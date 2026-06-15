import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { loadTaxonomy } from "@/lib/taxonomy";
import SupplierForm from "@/components/admin/SupplierForm";
import { updateSupplierAction, deleteSupplierAction } from "../actions";
import type { SupplierRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

export default async function EditSupplierPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ err?: string; msg?: string; saved?: string; created?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const supabase = createServiceRoleClient();
  const [{ data: supplier }, taxonomy] = await Promise.all([
    supabase.from("suppliers").select("*").eq("id", id).maybeSingle(),
    loadTaxonomy(),
  ]);
  if (!supplier) notFound();
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
      <h1 className="text-xl font-semibold">Edit supplier</h1>
      {(sp.saved || sp.created) && (
        <div className="mt-3 rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Saved ✓
        </div>
      )}
      {sp.err && (
        <div className="mt-3 rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <strong>{sp.err}</strong>: {sp.msg ?? ""}
        </div>
      )}
      <div className="mt-6">
        <SupplierForm
          action={updateSupplierAction}
          regions={regions}
          supplier={supplier as SupplierRow}
        />
      </div>

      <form
        action={deleteSupplierAction}
        className="mt-8 border-t border-neutral-100 pt-4"
      >
        <input type="hidden" name="id" value={supplier.id} />
        <button
          type="submit"
          className="rounded-md border border-rose-300 px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50"
        >
          Delete supplier
        </button>
        <span className="ml-3 text-xs text-neutral-400">
          Also removes its links to all products.
        </span>
      </form>
    </div>
  );
}
