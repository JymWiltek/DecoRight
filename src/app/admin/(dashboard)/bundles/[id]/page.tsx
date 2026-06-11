import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAdmin } from "@/lib/auth/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  addBundleProductAction,
  removeBundleProductAction,
  updateBundleStatusAction,
} from "../actions";

/** Wave 10 — bundle detail / edit. Lists attached products with a
 *  remove button per row; add-product form at the bottom. Publish
 *  chip flips status without round-tripping the whole form. */
export default async function BundleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{
    created?: string;
    product_added?: string;
    product_removed?: string;
    status_updated?: string;
    err?: string;
    msg?: string;
  }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const sp = (await searchParams) ?? {};

  const supabase = createServiceRoleClient();
  const { data: bundle } = await supabase
    .from("bundles")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!bundle) notFound();

  // Attached products with their names for display.
  const { data: links } = await supabase
    .from("bundle_products")
    .select("product_id, sort_order")
    .eq("bundle_id", id)
    .order("sort_order");
  const productIds = (links ?? []).map((l) => l.product_id);
  const { data: products } = productIds.length
    ? await supabase
        .from("products")
        .select("id, name, item_type, status, glb_url")
        .in("id", productIds)
    : { data: [] };
  const productMap = new Map(
    (products ?? []).map((p) => [p.id, p]),
  );

  return (
    <div className="mx-auto max-w-3xl p-6">
      <Link
        href="/admin/bundles"
        className="text-sm text-sky-700 hover:underline"
      >
        ← Bundles
      </Link>

      <div className="mt-3 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{bundle.name}</h1>
          <p className="text-sm text-neutral-500 font-mono">{bundle.slug}</p>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase text-neutral-500">Credit</div>
          <div className="text-2xl font-bold tabular-nums">
            {bundle.credit_cost}
          </div>
        </div>
      </div>

      {bundle.description && (
        <p className="mt-3 text-sm text-neutral-700">{bundle.description}</p>
      )}

      {sp.created && <Banner tone="green">Bundle created.</Banner>}
      {sp.product_added && <Banner tone="green">Product added.</Banner>}
      {sp.product_removed && <Banner tone="green">Product removed.</Banner>}
      {sp.status_updated && <Banner tone="green">Status updated.</Banner>}
      {sp.err && (
        <Banner tone="red">
          <strong>{sp.err}</strong>: {sp.msg ?? ""}
        </Banner>
      )}

      {/* Publish chip */}
      <Section title="Status">
        <form action={updateBundleStatusAction} className="flex items-center gap-3">
          <input type="hidden" name="bundle_id" value={id} />
          <input
            type="hidden"
            name="status"
            value={bundle.status === "published" ? "draft" : "published"}
          />
          <span
            className={
              bundle.status === "published"
                ? "rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-700 ring-1 ring-emerald-200"
                : "rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-700"
            }
          >
            {bundle.status}
          </span>
          <button
            type="submit"
            className="rounded border border-neutral-300 px-3 py-1 text-sm hover:border-black"
          >
            {bundle.status === "published" ? "Unpublish" : "Publish"}
          </button>
        </form>
      </Section>

      {/* Attached products */}
      <Section
        title={`Products in this bundle (${productIds.length})`}
      >
        {productIds.length === 0 ? (
          <p className="text-sm text-neutral-500">No products attached.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-neutral-500">
              <tr>
                <th className="px-2 py-1">Name</th>
                <th className="px-2 py-1">Item type</th>
                <th className="px-2 py-1">Status</th>
                <th className="px-2 py-1">Has GLB</th>
                <th className="px-2 py-1"></th>
              </tr>
            </thead>
            <tbody>
              {productIds.map((pid) => {
                const p = productMap.get(pid);
                return (
                  <tr key={pid} className="border-t border-neutral-100">
                    <td className="px-2 py-1">
                      <Link
                        href={`/admin/products/${pid}/edit`}
                        className="text-sky-700 hover:underline"
                      >
                        {p?.name ?? "(missing)"}
                      </Link>
                    </td>
                    <td className="px-2 py-1 text-xs">
                      {p?.item_type ?? "—"}
                    </td>
                    <td className="px-2 py-1 text-xs">{p?.status ?? "—"}</td>
                    <td className="px-2 py-1 text-xs">
                      {p?.glb_url ? "✓" : "—"}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <form action={removeBundleProductAction}>
                        <input
                          type="hidden"
                          name="bundle_id"
                          value={id}
                        />
                        <input
                          type="hidden"
                          name="product_id"
                          value={pid}
                        />
                        <button
                          type="submit"
                          className="text-xs text-rose-600 hover:text-rose-800"
                        >
                          Remove
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-sky-700">
            + Add product
          </summary>
          <form
            action={addBundleProductAction}
            className="mt-2 flex items-end gap-3"
          >
            <input type="hidden" name="bundle_id" value={id} />
            <div className="flex-1">
              <label className="block text-[10px] uppercase text-neutral-500">
                Product UUID
              </label>
              <input
                name="product_id"
                required
                placeholder="paste from /admin"
                className="w-full rounded border border-neutral-300 px-2 py-1 text-sm font-mono"
              />
            </div>
            <button
              type="submit"
              className="rounded bg-black px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
            >
              Add
            </button>
          </form>
        </details>
      </Section>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6 rounded-md border border-neutral-200 bg-white p-4">
      <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-500">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "green" | "red";
  children: React.ReactNode;
}) {
  const cls =
    tone === "green"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : "border-rose-200 bg-rose-50 text-rose-800";
  return (
    <div className={`mt-3 rounded border px-3 py-2 text-sm ${cls}`}>
      {children}
    </div>
  );
}
