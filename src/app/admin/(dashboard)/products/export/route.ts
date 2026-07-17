import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { absoluteUrl } from "@/lib/site-url";
import {
  buildProductWorkbook,
  type ProductExportRow,
} from "@/lib/admin/product-excel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /admin/products/export — the "Export to Excel" button. Streams every
 * product (draft + published) as a text-only .xlsx (no images). product_url
 * is built from NEXT_PUBLIC_SITE_URL via absoluteUrl (never hardcoded).
 */
export async function GET() {
  await requireAdmin();
  const supabase = createServiceRoleClient();

  const [{ data: products }, { data: links }, { data: suppliers }] =
    await Promise.all([
      supabase
        .from("products")
        .select(
          "id, name, sku_id, brand, item_type, subtype_slug, room_slugs, styles, materials, colors, dimensions_mm, price_myr, status",
        )
        .order("created_at", { ascending: false }),
      supabase.from("product_suppliers").select("product_id, supplier_id"),
      supabase.from("suppliers").select("id, name"),
    ]);

  const supplierName = new Map((suppliers ?? []).map((s) => [s.id, s.name]));
  const retailersByProduct = new Map<string, string[]>();
  for (const l of links ?? []) {
    const name = supplierName.get(l.supplier_id);
    if (!name) continue;
    const arr = retailersByProduct.get(l.product_id) ?? [];
    arr.push(name);
    retailersByProduct.set(l.product_id, arr);
  }

  const rows: ProductExportRow[] = (products ?? []).map((p) => ({
    ...p,
    retailerNames: retailersByProduct.get(p.id) ?? [],
  }));

  const buffer = await buildProductWorkbook(rows, (id) =>
    absoluteUrl(`/product/${id}`),
  );

  const stamp = new Date().toISOString().slice(0, 10);
  // Uint8Array is a valid BodyInit at runtime; cast past the DOM lib's
  // ArrayBuffer-vs-ArrayBufferLike generic mismatch.
  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="decoright-products-${stamp}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
