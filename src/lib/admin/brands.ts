import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * The brands table (mig 0053) — the single source for the brand picker and for
 * Settings → Brand. Kept separate from brand-normalize.ts so the casing-gate
 * rules stay a pure library; this file owns the table CRUD.
 */

export type BrandRow = { id: string; name: string; created_at: string };

/** All brands, alphabetical. Drives the Settings list. */
export async function listBrands(): Promise<BrandRow[]> {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from("brands")
    .select("id, name, created_at")
    .order("name");
  return (data ?? []) as BrandRow[];
}

/**
 * Insert a brand. `name` is expected to be ALREADY normalized by the caller
 * (normalizeBrand) so this stores the canonical spelling. Returns the clash
 * message on a unique / case-insensitive collision rather than throwing, so
 * both the Settings form and the combobox confirm-dialog can show it inline.
 */
export async function insertBrand(
  name: string,
): Promise<{ ok: true; brand: BrandRow } | { ok: false; error: string }> {
  const trimmed = name.trim();
  if (trimmed === "") return { ok: false, error: "Brand name can't be empty." };
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("brands")
    .insert({ name: trimmed })
    .select("id, name, created_at")
    .single();
  if (error) {
    // 23505 = unique_violation (either the name unique or the lower(name) idx)
    if (error.code === "23505") {
      return { ok: false, error: `"${trimmed}" is already a brand.` };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true, brand: data as BrandRow };
}

/**
 * Delete a brand ROW only. Deliberately does NOT touch products.brand — a
 * product keeping a brand string that's no longer in the table is fine (it
 * just won't be offered in the picker anymore). Clearing the catalog value is
 * a separate, explicit operation the operator does via inline edit / Excel.
 */
export async function deleteBrand(id: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("brands").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}
