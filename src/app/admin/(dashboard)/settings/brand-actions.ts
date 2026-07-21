"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { normalizeBrand } from "@/lib/admin/brand-normalize";
import { insertBrand, deleteBrand, type BrandRow } from "@/lib/admin/brands";

/**
 * Add a brand to the table. Runs the casing gate first so a brand can only
 * ever be stored in its canonical spelling — the same rule every write path
 * uses. Shared by Settings → Brand and the combobox "Add …" confirm dialog,
 * so both create brands identically. Returns the clash message inline instead
 * of throwing.
 */
export async function addBrandAction(
  name: string,
): Promise<{ ok: true; brand: BrandRow } | { ok: false; error: string }> {
  await requireAdmin();
  const normalized = await normalizeBrand(name);
  if (!normalized) return { ok: false, error: "Brand name can't be empty." };
  const res = await insertBrand(normalized);
  if (res.ok) revalidatePath("/admin/settings");
  return res;
}

/** Delete a brand ROW. Does NOT touch products.brand (see lib/admin/brands). */
export async function deleteBrandAction(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const res = await deleteBrand(id);
  if (res.ok) revalidatePath("/admin/settings");
  return res;
}
