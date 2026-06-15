"use server";

/**
 * Mig 0048 — supplier admin CRUD. Form-action style mirroring the
 * designers actions: every export re-asserts requireAdmin() (server
 * actions are URL-addressable), parses FormData, redirects with
 * ?err=&msg= on failure. Suppliers are operator-curated; the product
 * edit page then links them to products via product_suppliers.
 */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { SUPPLIER_TYPES, type SupplierType } from "@/lib/constants/enums";
import { invalidateSuppliersCache } from "@/lib/suppliers";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Digits-only Malaysian WhatsApp number (strip +, spaces, dashes).
 *  We don't hard-validate the MY format — operator owns correctness —
 *  only normalize so wa.me links work. */
function normalizeWhatsapp(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, "");
  return digits.length >= 8 ? digits : null;
}

function parseForm(fd: FormData): {
  name: string;
  logo_url: string | null;
  type: SupplierType;
  website_url: string | null;
  whatsapp: string | null;
  region_slugs: string[];
} {
  const type = String(fd.get("type") ?? "store");
  return {
    name: String(fd.get("name") ?? "").trim(),
    logo_url: String(fd.get("logo_url") ?? "").trim() || null,
    type: (SUPPLIER_TYPES as readonly string[]).includes(type)
      ? (type as SupplierType)
      : "store",
    website_url: String(fd.get("website_url") ?? "").trim() || null,
    whatsapp: normalizeWhatsapp(String(fd.get("whatsapp") ?? "")),
    region_slugs: fd.getAll("region_slugs").map((s) => s.toString()),
  };
}

export async function createSupplierAction(fd: FormData): Promise<void> {
  await requireAdmin();
  const p = parseForm(fd);
  if (!p.name) {
    redirect(
      `/admin/suppliers/new?err=name&msg=${encodeURIComponent("name required")}`,
    );
  }
  const supabase = createServiceRoleClient();
  const { data: row, error } = await supabase
    .from("suppliers")
    .insert(p)
    .select("id")
    .single();
  if (error || !row) {
    redirect(
      `/admin/suppliers/new?err=db&msg=${encodeURIComponent(error?.message ?? "insert returned no row")}`,
    );
  }
  invalidateSuppliersCache();
  revalidatePath("/admin/suppliers");
  redirect(`/admin/suppliers/${row.id}?created=1`);
}

export async function updateSupplierAction(fd: FormData): Promise<void> {
  await requireAdmin();
  const id = String(fd.get("id") ?? "");
  if (!UUID_RE.test(id)) {
    redirect(`/admin/suppliers?err=id&msg=${encodeURIComponent("invalid id")}`);
  }
  const p = parseForm(fd);
  if (!p.name) {
    redirect(
      `/admin/suppliers/${id}?err=name&msg=${encodeURIComponent("name required")}`,
    );
  }
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("suppliers")
    .update({ ...p, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    redirect(
      `/admin/suppliers/${id}?err=db&msg=${encodeURIComponent(error.message)}`,
    );
  }
  invalidateSuppliersCache();
  revalidatePath("/admin/suppliers");
  revalidatePath(`/admin/suppliers/${id}`);
  redirect(`/admin/suppliers/${id}?saved=1`);
}

export async function deleteSupplierAction(fd: FormData): Promise<void> {
  await requireAdmin();
  const id = String(fd.get("id") ?? "");
  if (!UUID_RE.test(id)) {
    redirect(`/admin/suppliers?err=id&msg=${encodeURIComponent("invalid id")}`);
  }
  const supabase = createServiceRoleClient();
  // product_suppliers rows cascade-delete via the FK (on delete cascade).
  const { error } = await supabase.from("suppliers").delete().eq("id", id);
  if (error) {
    redirect(
      `/admin/suppliers/${id}?err=db&msg=${encodeURIComponent(error.message)}`,
    );
  }
  invalidateSuppliersCache();
  revalidatePath("/admin/suppliers");
  redirect(`/admin/suppliers?deleted=1`);
}
