import "server-only";
import { unstable_cache, updateTag } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import type {
  Database,
  SupplierRow,
  ProductSupplierRow,
} from "@/lib/supabase/types";

/**
 * Supplier reads. Mig 0048 — products ↔ suppliers many-to-many.
 *
 * Anon client + unstable_cache for the storefront / product-form lists
 * (no cookies in cache scope, same pattern as taxonomy.ts). Admin pages
 * that need always-fresh data use the service-role client directly.
 */
function createAnonClient() {
  const url = process.env.NEXT_PUBLIC_APP_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_APP_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_APP_SUPABASE_URL or NEXT_PUBLIC_APP_SUPABASE_ANON_KEY",
    );
  }
  return createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const TAG = "suppliers";

/**
 * PB2 item 2 — "Others" is an internal-only retailer marker. Jym picks it
 * when a product genuinely has NO sales channel / showroom, so it satisfies
 * the required-retailer rule on bulk create while carrying the meaning
 * "no real channel". It must NEVER surface on the storefront: a product
 * whose only supplier link is "Others" renders the existing no-channel
 * lead-capture card, and the word "Others" never appears publicly.
 *
 * Matched by name (case-insensitive) so there's no schema/DDL change — the
 * row is a plain `suppliers` entry created by scripts/seed-others-supplier.mjs.
 * Admin CAN filter by it (to find products lacking channels); the storefront
 * strips it out.
 */
export const INTERNAL_SUPPLIER_NAME = "Others";

export function isInternalSupplier(
  s: { name: string } | null | undefined,
): boolean {
  return (
    !!s && s.name.trim().toLowerCase() === INTERNAL_SUPPLIER_NAME.toLowerCase()
  );
}

/** All suppliers, A→Z. Drives the product-edit picker + admin list. */
export const loadSuppliers = unstable_cache(
  async (): Promise<SupplierRow[]> => {
    const supabase = createAnonClient();
    const { data } = await supabase
      .from("suppliers")
      .select("*")
      .order("name", { ascending: true });
    return data ?? [];
  },
  ["suppliers-all-v1"],
  { tags: [TAG], revalidate: 300 },
);

/** Bust the suppliers cache after a create/update/delete. */
export function invalidateSuppliersCache(): void {
  updateTag(TAG);
}

/** A product's supplier links joined with the supplier row — for the
 *  product page "Where to buy" + the edit form's current selection.
 *  Sorted cheapest-channel first (nulls last) so the storefront can
 *  surface the best price at the top. */
export type ProductSupplierJoined = ProductSupplierRow & {
  supplier: SupplierRow | null;
};

export async function getProductSupplierLinks(
  productId: string,
): Promise<ProductSupplierJoined[]> {
  const supabase = createAnonClient();
  const { data } = await supabase
    .from("product_suppliers")
    .select("*, supplier:suppliers(*)")
    .eq("product_id", productId);
  const rows = (data ?? []) as unknown as ProductSupplierJoined[];
  // Cheapest first; rows without a price sink to the bottom.
  return rows.sort((a, b) => {
    const pa = a.price_myr ?? Number.POSITIVE_INFINITY;
    const pb = b.price_myr ?? Number.POSITIVE_INFINITY;
    return pa - pb;
  });
}
