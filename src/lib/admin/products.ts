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

export type AdminProductListOptions = {
  /** Free-text query — matches name / brand / item_type slug
   *  (case-insensitive substring). Server-side, not client filter,
   *  so 500-row catalogs don't slow the table down. */
  q?: string;
  /** Restrict to a single status badge (clicking the count chip in
   *  the header sets this). Empty = all statuses. */
  status?: "draft" | "published" | "archived" | "link_broken";
  sort?: AdminProductSort;
};

export type AdminProductListResult = {
  products: ProductRow[];
  /** Per-product image counts. Surfaces the "no images uploaded
   *  yet" situation in the table without an extra fetch per row. */
  imageCounts: Record<string, number>;
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

  const products = data ?? [];
  const ids = products.map((p) => p.id);
  let imageCounts: Record<string, number> = {};
  if (ids.length > 0) {
    // We just need a count per product. Pulling product_id only and
    // tallying in JS is two orders of magnitude lighter than N
    // count(*) queries. ~500 products ⇒ < 5K image rows in practice.
    const { data: imgRows } = await supabase
      .from("product_images")
      .select("product_id")
      .in("product_id", ids);
    imageCounts = (imgRows ?? []).reduce<Record<string, number>>((acc, r) => {
      acc[r.product_id] = (acc[r.product_id] ?? 0) + 1;
      return acc;
    }, {});
  }

  return { products, imageCounts };
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
