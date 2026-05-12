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
import PublishButton from "@/components/admin/PublishButton";

// Wave 6 · Commit 2 — "AI completeness" column on the admin list.
//
// Five fields the operator (and the AI auto-fill) routinely leave
// empty on freshly-created drafts: name, sku_id, brand, dimensions,
// description. A draft missing any of these isn't shippable — the
// product detail page will render with em-dashes where text should
// live, and search filters can't see it (sku/brand are searchable).
// The list shows ✅ when all five are filled and ⚠️ <missing list>
// otherwise so the operator can scan a long catalog for half-finished
// rows. "Untitled" is treated as missing — that's what /admin/products/new
// inserts when the operator clicks +New without typing anything.
const AI_COMPLETENESS_FIELDS = [
  "name",
  "sku_id",
  "brand",
  "dimensions",
  "description",
] as const;
type AiCompletenessField = (typeof AI_COMPLETENESS_FIELDS)[number];

// Wave 7 · Commit 3 — chip list helper for Rooms / Style columns.
// Renders the first two slug labels and a "+N more" tail when more
// exist. Empty input renders an em-dash. Pure function; called from
// the server-component render path, no client JS shipped.
function SlugChips({
  slugs,
  labelMap,
}: {
  slugs: string[];
  labelMap: Record<string, string>;
}) {
  if (!slugs || slugs.length === 0) {
    return <span className="text-neutral-400 text-xs">—</span>;
  }
  const visible = slugs.slice(0, 2);
  const rest = slugs.length - visible.length;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {visible.map((s) => (
        <span
          key={s}
          className="inline-block rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-700"
        >
          {labelMap[s] ?? s}
        </span>
      ))}
      {rest > 0 && (
        <span
          className="text-[11px] text-neutral-500"
          title={slugs.slice(2).map((s) => labelMap[s] ?? s).join(", ")}
        >
          +{rest} more
        </span>
      )}
    </div>
  );
}

// Wave 7 · Commit 3 — Missing column cell.
// Two kinds of "missing" info, both stored in products.missing_fields
// (mig 0039) by the V2 auto-publish tail:
//   • plain field names (e.g. "name", "dimensions_mm") — AI couldn't
//     fill these, operator must.
//   • "<field>_low_confidence" pseudo-keys — AI filled but flagged
//     low; operator should verify before publish.
//   • "publish_gate_<reason>" — non-AI gate failure (rooms / cutouts
//     / glb).
// Published rows render an em-dash; nothing to do.
function MissingCell({
  product,
}: {
  product: import("@/lib/supabase/types").ProductRow;
}) {
  if (product.status === "published") {
    return <span className="text-neutral-400 text-xs">—</span>;
  }
  const arr = product.missing_fields ?? [];
  if (arr.length === 0) {
    return <span className="text-neutral-400 text-xs">—</span>;
  }
  const missing: string[] = [];
  const lowConf: string[] = [];
  const gates: string[] = [];
  for (const key of arr) {
    if (key.endsWith("_low_confidence")) {
      lowConf.push(key.replace(/_low_confidence$/, ""));
    } else if (key.startsWith("publish_gate_")) {
      gates.push(key.replace(/^publish_gate_/, ""));
    } else {
      missing.push(key);
    }
  }
  return (
    <div className="flex flex-col gap-0.5 text-[11px]">
      {missing.length > 0 && (
        <div className="text-rose-700">
          <span className="font-semibold">Missing:</span> {missing.join(", ")}
        </div>
      )}
      {lowConf.length > 0 && (
        <div className="text-amber-700">
          <span className="font-semibold">Low confidence:</span>{" "}
          {lowConf.join(", ")}
        </div>
      )}
      {gates.length > 0 && (
        <div className="text-rose-700">
          <span className="font-semibold">Gate:</span> {gates.join(", ")}
        </div>
      )}
    </div>
  );
}

function aiCompletenessMissing(
  p: import("@/lib/supabase/types").ProductRow,
): AiCompletenessField[] {
  const missing: AiCompletenessField[] = [];
  if (!p.name || !p.name.trim() || p.name.trim() === "Untitled") {
    missing.push("name");
  }
  if (!p.sku_id || !p.sku_id.trim()) missing.push("sku_id");
  if (!p.brand || !p.brand.trim()) missing.push("brand");
  // dimensions_mm is { length?, width?, height? } — call it filled
  // when at least one axis has a positive number. An empty {} or all-
  // zero values count as missing because the spec block on the product
  // detail page wouldn't print anything.
  const d = p.dimensions_mm;
  const dimsFilled =
    d != null &&
    [d.length, d.width, d.height].some(
      (v) => typeof v === "number" && v > 0,
    );
  if (!dimsFilled) missing.push("dimensions");
  if (!p.description || !p.description.trim()) missing.push("description");
  return missing;
}

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
  /** Wave 2B · Commit 9: bulkUpdateStatusAction reports how many rows
   *  it skipped because they failed the 3-gate Publish check. Surfaced
   *  in the toast as "Updated N · K skipped (missing <reason>)". */
  blocked?: string;
  /** Wave 2B · Commit 9: the first failing gate reason from a bulk
   *  Publish (rooms · cutouts · glb). Used together with `blocked` so
   *  the toast names a likely fix. */
  reason?: string;
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
  // Wave 7 · Commit 3 — label maps for the new Rooms / Style columns.
  // Both render as chip lists (first 2 + "+N more") so the label needs
  // to be available without a per-row taxonomy lookup.
  const roomLabelMap = labelMap(taxonomy.rooms, "en");
  const styleLabelMap = labelMap(taxonomy.styles, "en");

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
        <div className="flex items-center gap-2">
          <Link
            href="/admin/products/bulk-create"
            className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:border-neutral-500"
          >
            + Bulk create
          </Link>
          <Link
            href="/admin/products/new"
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            + New product
          </Link>
        </div>
      </div>

      {/* Toasts for bulk action results */}
      {(sp.bulk || sp.bulk_deleted || sp.deleted || sp.err) && (() => {
        // Wave 2B · Commit 9: split logic so partial-success bulks
        // (some rows updated, some blocked by 3-gate Publish) render
        // a green "Updated N" with an amber "K skipped" sub-line.
        // The amber sub-line names the FIRST failing gate so the
        // operator gets a likely fix without opening every blocked
        // row.
        const blocked = sp.blocked ? Number(sp.blocked) : 0;
        const reasonLabel =
          sp.reason === "rooms"
            ? "no rooms picked"
            : sp.reason === "cutouts"
              ? "no approved cutouts"
              : sp.reason === "glb"
                ? "no GLB attached"
                : "missing publish requirements";
        const tone = sp.err
          ? "bg-rose-50 text-rose-700"
          : "bg-emerald-50 text-emerald-700";
        return (
          <div className={`mb-4 rounded-md px-4 py-2 text-sm ${tone}`}>
            {sp.err === "publish_blocked"
              ? `Publish blocked: ${reasonLabel}. Open Edit to fix.`
              : sp.err
                ? `Error (${sp.err}): ${sp.msg ?? ""}`
                : sp.bulk_deleted
                  ? `Deleted ${sp.bulk_deleted} product(s).`
                  : sp.bulk
                    ? `Updated ${sp.bulk} product(s).`
                    : sp.deleted
                      ? `Deleted.`
                      : null}
            {!sp.err && blocked > 0 && (
              <span className="ml-2 rounded-md bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                {blocked} skipped ({reasonLabel})
              </span>
            )}
          </div>
        );
      })()}

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
                <th className="px-4 py-3">SKU</th>
                <th className="px-4 py-3">Brand</th>
                <th className="px-4 py-3">Item / Subtype</th>
                <th className="px-4 py-3">Rooms</th>
                <th className="px-4 py-3">Style</th>
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
                <th className="px-4 py-3">3D</th>
                <th className="px-4 py-3">AI</th>
                <th className="px-4 py-3">Missing</th>
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
                        <div className="font-medium text-neutral-900">
                          <Link
                            href={`/admin/products/${p.id}/edit`}
                            className="hover:underline"
                          >
                            {p.name}
                          </Link>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 align-middle text-xs">
                      {p.sku_id ? (
                        <span className="font-mono text-neutral-700">
                          {p.sku_id}
                        </span>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-middle text-xs">
                      {p.brand ? (
                        <span className="text-neutral-700">{p.brand}</span>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
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
                      <SlugChips
                        slugs={p.room_slugs ?? []}
                        labelMap={roomLabelMap}
                      />
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <SlugChips
                        slugs={p.styles ?? []}
                        labelMap={styleLabelMap}
                      />
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <PriceCell productId={p.id} current={p.price_myr} />
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <StatusCell productId={p.id} current={p.status} />
                    </td>
                    <td className="px-4 py-3 align-middle text-center text-sm">
                      {p.glb_url ? (
                        <span title="GLB attached" aria-label="3D model present">
                          ✅
                        </span>
                      ) : (
                        <span title="No GLB" aria-label="No 3D model">
                          ❌
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-middle text-xs">
                      {(() => {
                        const missing = aiCompletenessMissing(p);
                        if (missing.length === 0) {
                          return (
                            <span title="All key fields filled" aria-label="AI complete">
                              ✅
                            </span>
                          );
                        }
                        return (
                          <span
                            className="inline-flex items-center gap-1 text-amber-700"
                            title={`Missing: ${missing.join(", ")}`}
                          >
                            <span aria-hidden>⚠️</span>
                            <span className="text-[11px] text-amber-800">
                              {missing.join(", ")}
                            </span>
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <MissingCell product={p} />
                    </td>
                    <td className="px-4 py-3 align-middle text-xs text-neutral-500">
                      <div>
                        {p.glb_url ? `${p.glb_size_kb ?? "?"} KB` : "—"}
                      </div>
                      {/* Wave 2A · Commit 6: surface the new "GLB
                          ready, awaiting Publish" intermediate state
                          on the list. The held-back-status auto-promote
                          retired in this commit means a successful
                          Meshy run leaves the row at status='draft' —
                          without a hint here the operator has no
                          easy way to find products that are ready to
                          ship. The chip points the operator at the
                          edit page where the Publish button is. Only
                          fires when meshy says succeeded AND the GLB
                          actually landed AND the row is still draft —
                          published rows don't need a nudge. */}
                      {p.meshy_status === "succeeded" &&
                        p.glb_url &&
                        p.status === "draft" && (
                          <div className="mt-0.5">
                            <Link
                              href={`/admin/products/${p.id}/edit`}
                              className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100"
                              title="3D model is ready. Click to open the edit page and Publish."
                            >
                              <span aria-hidden>●</span>
                              3D ready · awaiting Publish
                            </Link>
                          </div>
                        )}
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
                      <div className="flex items-center justify-end gap-2">
                        {p.status === "draft" && (
                          <PublishButton productId={p.id} />
                        )}
                        <Link
                          href={`/admin/products/${p.id}/edit`}
                          className="text-sm text-neutral-700 hover:text-black"
                        >
                          Edit
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {products.length === 0 && (
                <tr>
                  <td
                    colSpan={15}
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
