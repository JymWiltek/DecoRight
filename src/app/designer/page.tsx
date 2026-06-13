import Link from "next/link";
import type { Metadata } from "next";
import { BRAND } from "@config/brand";
import { requireDesigner } from "@/lib/auth/require-designer";
import { getCreditBalance } from "@/lib/credit";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { designerLogout } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Designer Dashboard" };

export default async function DesignerDashboard() {
  const { designerId } = await requireDesigner();
  const supabase = createServiceRoleClient();

  const [designerRes, balance, downloadsRes] = await Promise.all([
    supabase.from("designers").select("name, email").eq("id", designerId).single(),
    getCreditBalance(designerId),
    supabase
      .from("downloads")
      .select("id, file_type, credit_cost, downloaded_at, product_id")
      .eq("designer_id", designerId)
      .order("downloaded_at", { ascending: false })
      .limit(50),
  ]);
  const designer = designerRes.data;
  const downloads = downloadsRes.data ?? [];

  // Resolve product names for the history rows (no FK embed — avoids
  // type/relationship coupling).
  const productIds = [...new Set(downloads.map((d) => d.product_id).filter(Boolean))] as string[];
  const { data: prods } = productIds.length
    ? await supabase.from("products").select("id, name").in("id", productIds)
    : { data: [] as { id: string; name: string }[] };
  const nameById = new Map((prods ?? []).map((p) => [p.id, p.name]));

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <Link href="/" className="text-lg font-bold tracking-tight text-neutral-900">
          {BRAND.name}
        </Link>
        <form action={designerLogout}>
          <button
            type="submit"
            className="rounded-full border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 transition hover:border-neutral-900"
          >
            Sign out
          </button>
        </form>
      </div>

      <h1 className="text-2xl font-semibold text-neutral-900">
        {designer?.name ?? "Designer"}
      </h1>
      <p className="text-sm text-neutral-500">{designer?.email}</p>

      {/* Credit balance */}
      <div className="mt-6 rounded-xl border border-neutral-200 bg-neutral-50 p-6">
        <div className="text-sm text-neutral-500">Credit balance</div>
        <div className="mt-1 text-3xl font-bold text-neutral-900">
          {balance ?? 0} credit
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          Top up via WhatsApp — DecoRight credits your account manually.
        </p>
      </div>

      {/* Download history */}
      <h2 className="mt-10 mb-3 text-lg font-semibold text-neutral-900">
        Download history
      </h2>
      {downloads.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-500">
          No downloads yet.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-neutral-200">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-4 py-2 font-medium">Product</th>
                <th className="px-4 py-2 font-medium">File</th>
                <th className="px-4 py-2 font-medium">Credit</th>
                <th className="px-4 py-2 font-medium">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {downloads.map((d) => (
                <tr key={d.id}>
                  <td className="px-4 py-2 text-neutral-800">
                    {d.product_id ? nameById.get(d.product_id) ?? "—" : "—"}
                  </td>
                  <td className="px-4 py-2 uppercase text-neutral-500">{d.file_type}</td>
                  <td className="px-4 py-2 text-neutral-800">{d.credit_cost}</td>
                  <td className="px-4 py-2 text-neutral-500">
                    {new Date(d.downloaded_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
