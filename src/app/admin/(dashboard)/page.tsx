import Link from "next/link";
import {
  listAllProducts,
  type AdminProductSort,
} from "@/lib/admin/products";
import { loadTaxonomy, labelMap } from "@/lib/taxonomy";
import { PRODUCT_STATUS_LABELS } from "@/lib/constants/enum-labels";
import {
  PRODUCT_STATUSES,
  type ProductStatus,
} from "@/lib/constants/enums";
import SearchBar from "@/components/admin/SearchBar";
import SortableHeader from "@/components/admin/SortableHeader";
import StatusCell from "@/components/admin/StatusCell";
import PriceCell from "@/components/admin/PriceCell";
import ItemTypeCell from "@/components/admin/ItemTypeCell";
import BulkBar from "@/components/admin/BulkBar";
import SelectAllCheckbox from "@/components/admin/SelectAllCheckbox";

export const dynamic = "force-dynamic";

const VALID_SORTS: AdminProductSort[] = [
  "updated_desc",
  "updated_asc",
  "name_asc",
  "name_desc",
  "price_asc",
  "price_desc",
  "status_asc",
  "status_desc",
];

const STATUS_CHIP_STYLES: Record<string, string> = {
  draft: "bg-neutral-100 text-neutral-700",
  published: "bg-emerald-100 text-emerald-700",
  archived: "bg-amber-100 text-amber-800",
  link_broken: "bg-red-100 text-red-700",
};

type SearchParams = Promise<{
  q?: string;
  status?: string;
  sort?: string;
  bulk?: string;
  bulk_deleted?: string;
  deleted?: string;
  err?: string;
  msg?: string;
}>;

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;

  const sort: AdminProductSort = (VALID_SORTS as readonly string[]).includes(
    sp.sort ?? "",
  )
    ? (sp.sort as AdminProductSort)
    : "updated_desc";

  const statusFilter = (PRODUCT_STATUSES as readonly string[]).includes(
    sp.status ?? "",
  )
    ? (sp.status as ProductStatus)
    : undefined;

  const [{ products, imageCounts }, taxonomy] = await Promise.all([
    listAllProducts({
      q: sp.q,
      status: statusFilter,
      sort,
    }),
    loadTaxonomy(),
  ]);

  // /admin is hardcoded English; pass "en" explicitly so admin pill
  // labels stay English regardless of the operator's locale cookie.
  const itemTypeLabels = labelMap(taxonomy.itemTypes, "en");
  const itemTypeOptions = taxonomy.itemTypes.map((r) => ({
    slug: r.slug,
    label: r.label_en,
  }));

  // Counts are computed across the FILTERED set so the operator sees
  // "what the chips say I'd see if I clicked them". For unfiltered
  // overview totals run a separate count query — left as a future
  // enhancement; the filter chips below show the in-view tally.
  const byStatus = products.reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1;
    return acc;
  }, {});

  // SortableHeader needs to preserve every other query param.
  const preserve: Record<string, string | undefined> = {
    q: sp.q,
    status: sp.status,
  };

  function chipHref(forStatus: ProductStatus | "all"): string {
    const params = new URLSearchParams();
    if (sp.q) params.set("q", sp.q);
    if (sp.sort) params.set("sort", sp.sort);
    if (forStatus !== "all") params.set("status", forStatus);
    return `/admin?${params.toString()}`;
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 pb-32">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Products</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {products.length} shown
            {sp.q && ` · matching "${sp.q}"`}
            {statusFilter && ` · status=${PRODUCT_STATUS_LABELS[statusFilter]}`}
          </p>
        </div>
        <Link
          href="/admin/products/new"
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          + New product
        </Link>
      </div>

      {/* Toasts for bulk action results */}
      {(sp.bulk || sp.bulk_deleted || sp.deleted || sp.err) && (
        <div
          className={`mb-4 rounded-md px-4 py-2 text-sm ${
            sp.err
              ? "bg-rose-50 text-rose-700"
              : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {sp.err
            ? `Error (${sp.err}): ${sp.msg ?? ""}`
            : sp.bulk_deleted
              ? `Deleted ${sp.bulk_deleted} product(s).`
              : sp.bulk
                ? `Updated ${sp.bulk} product(s).`
                : sp.deleted
                  ? `Deleted.`
                  : null}
        </div>
      )}

      {/* Search + status filter chips */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchBar />
        <div className="flex flex-wrap gap-1.5">
          <Link
            href={chipHref("all")}
            className={`rounded-full px-3 py-1 text-xs transition ${
              !statusFilter
                ? "bg-black text-white"
                : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
            }`}
          >
            All
          </Link>
          {(["published", "draft", "archived", "link_broken"] as const).map(
            (s) => (
              <Link
                key={s}
                href={chipHref(s)}
                className={`rounded-full px-3 py-1 text-xs transition ${
                  statusFilter === s
                    ? `${STATUS_CHIP_STYLES[s]} ring-1 ring-black`
                    : `${STATUS_CHIP_STYLES[s]} hover:opacity-80`
                }`}
              >
                {PRODUCT_STATUS_LABELS[s]}
                {byStatus[s] ? ` (${byStatus[s]})` : ""}
              </Link>
            ),
          )}
        </div>
      </div>

      {/* The bulk form wraps the table so per-row checkboxes belong
          to it. Action is dispatched at button-click time via
          formAction= override, so the form's own action= is unused
          (set to a no-op redirect-to-self via empty action). */}
      <form id="bulk-form" action="">
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="w-10 px-4 py-3">
                  <SelectAllCheckbox />
                </th>
                <th className="px-4 py-3">
                  <SortableHeader
                    label="Product"
                    field="name"
                    current={sort}
                    preserveParams={preserve}
                  />
                </th>
                <th className="px-4 py-3">Item / Subtype</th>
                <th className="px-4 py-3">
                  <SortableHeader
                    label="Price"
                    field="price"
                    current={sort}
                    preserveParams={preserve}
                  />
                </th>
                <th className="px-4 py-3">
                  <SortableHeader
                    label="Status"
                    field="status"
                    current={sort}
                    preserveParams={preserve}
                  />
                </th>
                <th className="px-4 py-3">3D / Imgs</th>
                <th className="px-4 py-3">
                  <SortableHeader
                    label="Updated"
                    field="updated"
                    current={sort}
                    preserveParams={preserve}
                  />
                </th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const imgN = imageCounts[p.id] ?? 0;
                return (
                  <tr
                    key={p.id}
                    className="border-b border-neutral-100 last:border-0"
                  >
                    <td className="px-4 py-3 align-middle">
                      <input
                        type="checkbox"
                        name="ids"
                        value={p.id}
                        className="h-4 w-4 rounded border-neutral-300"
                        aria-label={`Select ${p.name}`}
                      />
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <div className="flex items-center gap-3">
                        <div className="relative h-10 w-10 overflow-hidden rounded bg-neutral-100">
                          {p.thumbnail_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={p.thumbnail_url}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <span className="absolute inset-0 flex items-center justify-center text-[9px] text-neutral-400">
                              no img
                            </span>
                          )}
                        </div>
                        <div>
                          <div className="font-medium text-neutral-900">
                            <Link
                              href={`/admin/products/${p.id}/edit`}
                              className="hover:underline"
                            >
                              {p.name}
                            </Link>
                          </div>
                          <div className="text-xs text-neutral-500">
                            {p.brand ?? "—"}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <div className="flex flex-col gap-0.5">
                        <ItemTypeCell
                          productId={p.id}
                          current={p.item_type}
                          options={itemTypeOptions}
                        />
                        {p.subtype_slug && (
                          <span className="text-[11px] text-neutral-500">
                            ↳ {p.subtype_slug}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <PriceCell productId={p.id} current={p.price_myr} />
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <StatusCell productId={p.id} current={p.status} />
                    </td>
                    <td className="px-4 py-3 align-middle text-xs text-neutral-500">
                      <div>
                        {p.glb_url ? `${p.glb_size_kb ?? "?"} KB` : "—"}
                      </div>
                      <div
                        className={
                          imgN === 0
                            ? "font-semibold text-rose-600"
                            : "text-neutral-500"
                        }
                      >
                        {imgN === 0 ? "0 imgs" : `${imgN} imgs`}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-middle text-xs text-neutral-500">
                      {new Date(p.updated_at).toLocaleString("en-MY")}
                    </td>
                    <td className="px-4 py-3 text-right align-middle">
                      <Link
                        href={`/admin/products/${p.id}/edit`}
                        className="text-sm text-neutral-700 hover:text-black"
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {products.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-12 text-center text-sm text-neutral-500"
                  >
                    {sp.q || statusFilter ? (
                      <>
                        No products match these filters.{" "}
                        <Link href="/admin" className="text-sky-600 hover:underline">
                          Clear filters
                        </Link>
                      </>
                    ) : (
                      <>No products yet. Click &ldquo;New product&rdquo; above.</>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </form>

      <BulkBar totalRows={products.length} />
    </div>
  );
}
