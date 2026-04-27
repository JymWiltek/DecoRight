import { createServiceRoleClient } from "@/lib/supabase/service";
import type { ProductRow } from "@/lib/supabase/types";

export type AdminProductSort =
  | "updated_desc"
  | "updated_asc"
  | "name_asc"
  | "name_desc"
  | "price_asc"
  | "price_desc"
  | "status_asc"
  | "status_desc";

/** Sentinel passed for `itemType` to filter rows where item_type IS NULL.
 *  We need a value distinct from "" (= "no filter") and from any real
 *  item_type slug. Picking a string with double underscores keeps it
 *  obviously synthetic — no taxonomy slug will ever look like this. */
export const ITEM_TYPE_NONE = "__none__" as const;

export type AdminProductListOptions = {
  /** Free-text query — matches name / brand / item_type slug
   *  (case-insensitive substring). Server-side, not client filter,
   *  so 500-row catalogs don't slow the table down. */
  q?: string;
  /** Restrict to a single status badge (clicking the count chip in
   *  the header sets this). Empty = all statuses. */
  status?: "draft" | "published" | "archived" | "link_broken";
  /** Restrict to a single item_type slug, or to rows with item_type IS
   *  NULL when set to ITEM_TYPE_NONE. Validated by the page component
   *  against the taxonomy before reaching this layer — listAllProducts
   *  itself just trusts the value. */
  itemType?: string;
  sort?: AdminProductSort;
  /** Phase 1 收尾 P1 fix: hide "empty draft" rows (status='draft'
   *  AND no images AND no rooms). The /admin/products/new flow
   *  inserts an Untitled draft on every navigation, so refreshing
   *  /new or hitting "+ New" then closing without filling fields
   *  leaves orphans. The page defaults this to true and surfaces
   *  a "Show empty drafts" chip to override. Filter applies AFTER
   *  the DB fetch — we already have imageCounts loaded for the
   *  rendered set, so re-using that costs nothing. */
  hideEmptyDrafts?: boolean;
};

export type AdminProductListResult = {
  products: ProductRow[];
  /** Per-product image counts. Surfaces the "no images uploaded
   *  yet" situation in the table without an extra fetch per row. */
  imageCounts: Record<string, number>;
  /** Per-product list of image ids stuck in a pre-approval state
   *  (raw or cutout_failed). The direct-upload dropzone can leave
   *  rows in `raw` if the browser closed mid-kickRembg, or in
   *  `cutout_failed` if rembg errored. The admin list surfaces a
   *  one-click "Retry rembg" button for these. */
  stuckImageIds: Record<string, string[]>;
};

export async function listAllProducts(
  opts: AdminProductListOptions = {},
): Promise<AdminProductListResult> {
  const supabase = createServiceRoleClient();

  let query = supabase.from("products").select("*");

  if (opts.q && opts.q.trim()) {
    // ilike works on text columns; item_type is text. We OR across
    // the three searchable scalars. Brands and item_types have low
    // cardinality so this stays fast even on 10K rows.
    const like = `%${opts.q.trim().replace(/[%_]/g, "\\$&")}%`;
    query = query.or(
      `name.ilike.${like},brand.ilike.${like},item_type.ilike.${like}`,
    );
  }

  if (opts.status) {
    query = query.eq("status", opts.status);
  }

  if (opts.itemType === ITEM_TYPE_NONE) {
    // Surface the rows that haven't been classified yet so the operator
    // can clean them up. Without this filter they're hard to find since
    // they have no human-readable item_type to search for.
    query = query.is("item_type", null);
  } else if (opts.itemType) {
    query = query.eq("item_type", opts.itemType);
  }

  switch (opts.sort ?? "updated_desc") {
    case "updated_asc":
      query = query.order("updated_at", { ascending: true });
      break;
    case "name_asc":
      query = query.order("name", { ascending: true });
      break;
    case "name_desc":
      query = query.order("name", { ascending: false });
      break;
    case "price_asc":
      query = query.order("price_myr", { ascending: true, nullsFirst: false });
      break;
    case "price_desc":
      query = query.order("price_myr", { ascending: false, nullsFirst: false });
      break;
    case "status_asc":
      query = query.order("status", { ascending: true });
      break;
    case "status_desc":
      query = query.order("status", { ascending: false });
      break;
    case "updated_desc":
    default:
      query = query.order("updated_at", { ascending: false });
  }

  const { data, error } = await query.limit(500);
  if (error) throw error;

  let products = data ?? [];
  const ids = products.map((p) => p.id);
  let imageCounts: Record<string, number> = {};
  const stuckImageIds: Record<string, string[]> = {};
  if (ids.length > 0) {
    // We need total counts + ids of stuck rows. One query, select
    // (id, product_id, state) and bucket in JS — still an order of
    // magnitude lighter than N×count queries, and the stuck payload
    // stays tiny because most products have 0 stuck images.
    const { data: imgRows } = await supabase
      .from("product_images")
      .select("id,product_id,state")
      .in("product_id", ids);
    imageCounts = (imgRows ?? []).reduce<Record<string, number>>((acc, r) => {
      acc[r.product_id] = (acc[r.product_id] ?? 0) + 1;
      return acc;
    }, {});
    for (const r of imgRows ?? []) {
      if (r.state === "raw" || r.state === "cutout_failed") {
        const list = stuckImageIds[r.product_id] ?? [];
        list.push(r.id);
        stuckImageIds[r.product_id] = list;
      }
    }
  }

  // Empty-draft filter runs AFTER imageCounts is built so the rule
  // "no images" can read straight from the loaded map. Applying it in
  // SQL would require a join + group_by + filter on count(*) — doable
  // but uglier and harder to keep in sync with the "stuck images"
  // bookkeeping above. JS filter at ≤500 rows is essentially free.
  //
  // Definition: status='draft' AND zero product_images rows AND
  // empty room_slugs[]. All three conditions together — a draft with
  // even one photo or one tagged room is "in progress", not orphan
  // garbage. Operator can re-surface them via ?show_drafts=1 toggle
  // (handled in the page).
  if (opts.hideEmptyDrafts) {
    products = products.filter((p) => {
      const isEmptyDraft =
        p.status === "draft" &&
        (imageCounts[p.id] ?? 0) === 0 &&
        (!p.room_slugs || p.room_slugs.length === 0);
      return !isEmptyDraft;
    });
  }

  return { products, imageCounts, stuckImageIds };
}

export async function getProductById(id: string): Promise<ProductRow | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}
