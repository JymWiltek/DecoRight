import Link from "next/link";
import {
  listAllProducts,
  ITEM_TYPE_NONE,
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
import ItemTypeFilter from "@/components/admin/ItemTypeFilter";
import BulkBar from "@/components/admin/BulkBar";
import SelectAllCheckbox from "@/components/admin/SelectAllCheckbox";
import RetryRembgInlineButton from "@/components/admin/RetryRembgInlineButton";
import ThumbnailSwapButton from "@/components/admin/ThumbnailSwapButton";

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
  /** Item type filter — a taxonomy slug, or "__none__" for NULL rows.
   *  Validated against the loaded taxonomy before use; anything else
   *  is silently dropped (no 404 — the user just sees the unfiltered
   *  list, same behavior as an unknown ?status=). */
  type?: string;
  sort?: string;
  bulk?: string;
  bulk_deleted?: string;
  deleted?: string;
  err?: string;
  msg?: string;
  /** "1" = include empty drafts in the listing (overrides the default
   *  hide). Empty drafts = status='draft' AND no images AND no rooms,
   *  the orphan rows the /admin/products/new auto-create flow leaves
   *  behind when the operator clicks +New and then closes without
   *  filling anything. Off by default so the list stays clean. */
  show_drafts?: string;
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

  // Load the taxonomy first so we can validate ?type= against the live
  // set of item type slugs before passing it to listAllProducts. Two
  // valid shapes: an actual slug, or the "__none__" sentinel for
  // NULL-item_type rows. Anything else is dropped — invalid params
  // never reach the DB layer.
  const taxonomy = await loadTaxonomy();
  const validItemTypeSlugs = new Set(taxonomy.itemTypes.map((r) => r.slug));
  // Note: We compare against the literal "__none__" rather than
  // importing ITEM_TYPE_NONE_PARAM from the client component. Importing
  // a primitive constant from a "use client" module into a server
  // component sometimes resolves to undefined under Turbopack, which
  // silently broke the (untyped) filter (the literal !== undefined
  // comparison always fell through to the slug branch). Importing the
  // server-side `ITEM_TYPE_NONE` (also "__none__") works, but the
  // literal makes the contract explicit at the read site.
  const itemTypeParam =
    sp.type === ITEM_TYPE_NONE
      ? ITEM_TYPE_NONE
      : sp.type && validItemTypeSlugs.has(sp.type)
        ? sp.type
        : undefined;

  // Empty-draft hide is the DEFAULT — only toggled off when the
  // operator explicitly asks. ?show_drafts=1 is the override; any
  // other value (or absence) keeps the filter on. Applying the
  // filter when status='draft' is explicitly selected would hide
  // every draft the operator just clicked into, so honor the
  // explicit status filter by leaving the show_drafts default
  // unchanged but resolve the same way (the empty-draft rule is
  // "draft + no images + no rooms" — a draft you want to see has at
  // least one of those, so the filter naturally lets normal drafts
  // through). The chip below makes the bypass discoverable.
  const showEmptyDrafts = sp.show_drafts === "1";

  const { products, imageCounts, stuckImageIds } = await listAllProducts({
    q: sp.q,
    status: statusFilter,
    itemType: itemTypeParam,
    sort,
    hideEmptyDrafts: !showEmptyDrafts,
  });

  // /admin is hardcoded English; pass "en" explicitly so admin pill
  // labels stay English regardless of the operator's locale cookie.
  const itemTypeLabels = labelMap(taxonomy.itemTypes, "en");
  const itemTypeOptions = taxonomy.itemTypes.map((r) => ({
    slug: r.slug,
    label: r.label_en,
  }));

  // The Item Type filter dropdown wants the full tri-lingual rows so
  // each chip can show EN/ZH/MS. Stable alpha order by label_en keeps
  // the operator's eye trained on a predictable layout.
  const itemTypeFilterOptions = [...taxonomy.itemTypes]
    .sort((a, b) => a.label_en.localeCompare(b.label_en))
    .map((r) => ({
      slug: r.slug,
      label_en: r.label_en,
      label_zh: r.label_zh,
      label_ms: r.label_ms,
    }));

  // Per-item-type counts within the current (search + status filtered)
  // set. The dropdown chips show "(N)" so the operator can see which
  // types have rows before clicking. Includes the "__none__" key for
  // products whose item_type IS NULL.
  const itemTypeCounts = products.reduce<Record<string, number>>((acc, p) => {
    const k = p.item_type ?? ITEM_TYPE_NONE;
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

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
    type: sp.type,
    show_drafts: sp.show_drafts,
  };

  function chipHref(forStatus: ProductStatus | "all"): string {
    const params = new URLSearchParams();
    if (sp.q) params.set("q", sp.q);
    if (sp.sort) params.set("sort", sp.sort);
    if (sp.type) params.set("type", sp.type);
    if (sp.show_drafts) params.set("show_drafts", sp.show_drafts);
    if (forStatus !== "all") params.set("status", forStatus);
    return `/admin?${params.toString()}`;
  }

  // Toggle for "Show empty drafts". When the toggle is on, the URL
  // gets ?show_drafts=1; clicking again drops the param. Preserves
  // every other filter so the operator doesn't lose context.
  const showDraftsToggleHref = (() => {
    const params = new URLSearchParams();
    if (sp.q) params.set("q", sp.q);
    if (sp.sort) params.set("sort", sp.sort);
    if (sp.type) params.set("type", sp.type);
    if (sp.status) params.set("status", sp.status);
    if (!showEmptyDrafts) params.set("show_drafts", "1");
    const qs = params.toString();
    return qs ? `/admin?${qs}` : "/admin";
  })();

  // Pretty label for the "X shown · type=Faucet" header line. We
  // resolve the slug back to a label so the operator sees a name,
  // not a slug.
  let itemTypeFilterLabel: string | undefined;
  if (itemTypeParam === ITEM_TYPE_NONE) {
    itemTypeFilterLabel = "(untyped)";
  } else if (itemTypeParam) {
    itemTypeFilterLabel = itemTypeLabels[itemTypeParam] ?? itemTypeParam;
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
            {itemTypeFilterLabel && ` · type=${itemTypeFilterLabel}`}
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

      {/* Search + status chips + item type dropdown */}
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
        <ItemTypeFilter
          options={itemTypeFilterOptions}
          current={itemTypeParam}
          counts={itemTypeCounts}
        />
        {/* Empty-draft toggle (Phase 1 收尾 P1).
            ON state = orphans hidden (default + cleaner list).
            OFF state = "Show empty drafts" CTA visible to bring them back.
            Lives next to the item-type filter so it reads as a list-shaping
            control, not a status badge. */}
        <Link
          href={showDraftsToggleHref}
          className={`rounded-full px-3 py-1 text-xs transition ${
            showEmptyDrafts
              ? "bg-amber-100 text-amber-800 ring-1 ring-amber-400"
              : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
          }`}
          title={
            showEmptyDrafts
              ? "Currently showing empty drafts (no images + no rooms). Click to hide them."
              : "Empty drafts (no images + no rooms) are hidden. Click to reveal them."
          }
        >
          {showEmptyDrafts ? "✓ Empty drafts shown" : "Show empty drafts"}
        </Link>
      </div>

      {/* The bulk form wraps the table so per-row checkboxes belong
          to it. BulkBar's submit buttons use formAction= to pick the
          right server action. StatusCell / PriceCell / ItemTypeCell
          DO NOT render their own <form> — they call the server action
          directly via onClick to avoid invalid nested <form> HTML. */}
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
                        {/* Inline swap: click the tile to replace the
                            thumbnail without leaving the list. Falls
                            back to "no img" when the row hasn't been
                            given one yet — that placeholder is also
                            clickable. */}
                        <ThumbnailSwapButton
                          productId={p.id}
                          currentUrl={p.thumbnail_url}
                        />
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
                      {/* Direct-upload fallback: if the browser closed
                          mid-kickRembg or rembg itself errored, some
                          images sit in `raw` / `cutout_failed` forever.
                          Give the operator a one-click recovery path
                          from the list so they don't have to open each
                          product to see a cutout_failed card. */}
                      {stuckImageIds[p.id] && stuckImageIds[p.id].length > 0 && (
                        <div className="mt-1">
                          <RetryRembgInlineButton
                            productId={p.id}
                            imageIds={stuckImageIds[p.id]}
                          />
                        </div>
                      )}
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
