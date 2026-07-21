import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * Brand casing gate.
 *
 * The catalog had already grown case variants of the same brand
 * (SANIWARE / Saniware, DOCASA / Docasa, WILTEK / Wiltek). Rather than police
 * this by hand, every write path runs the input through here first: if the
 * brand already exists in the catalog under some casing, we store THAT casing.
 *
 * Deliberately NOT doing:
 *   • no cleanup of existing rows — Jym re-casts the back catalog via Excel;
 *   • no "unknown brand" rejection — a genuinely new brand is stored verbatim.
 *     This only collapses CASE variants of brands we already carry.
 *
 * The match set is the `brands` table (mig 0053, managed from Settings →
 * Brand). It began life as DISTINCT products.brand and is seeded from it.
 *
 * The rule lives once in `normalizeBrandAgainst`. Single-row callers use
 * `normalizeBrand`; batch callers (Excel import) load the known set once and
 * call the pure function per row so an N-row import is still one query.
 */

/** Canonical brand spellings from the `brands` table — the option list every
 *  picker offers and the set the casing gate matches against. */
export async function loadKnownBrands(): Promise<string[]> {
  // Mig 0053 — brands now live in their own table (managed from Settings →
  // Brand), instead of being re-derived from DISTINCT products.brand on every
  // call. Single entry point unchanged: every caller (the product list, the
  // edit page, the Excel importer) still gets a string[] of canonical
  // spellings, so nothing downstream had to move.
  const supabase = createServiceRoleClient();
  const { data } = await supabase.from("brands").select("name");
  return (data ?? []).map((r) => r.name).filter((n): n is string => !!n);
}

/**
 * THE rule. Pure — no I/O, so it's trivially testable and identical for every
 * caller.
 *
 *   trim → empty means "not filled", stored as NULL (never an error)
 *   case-insensitive hit in `known` → return that known spelling
 *   no hit → return the trimmed input verbatim (a new brand is allowed)
 */
export function normalizeBrandAgainst(
  input: string | null | undefined,
  known: Iterable<string>,
): string | null {
  const trimmed = (input ?? "").trim();
  if (trimmed === "") return null;
  const key = trimmed.toLowerCase();
  for (const candidate of known) {
    if (candidate.trim().toLowerCase() === key) return candidate.trim();
  }
  return trimmed;
}

/** Single-row convenience: load the known set, then apply the rule. */
export async function normalizeBrand(
  input: string | null | undefined,
): Promise<string | null> {
  // Skip the query entirely when there's nothing to match.
  if ((input ?? "").trim() === "") return null;
  return normalizeBrandAgainst(input, await loadKnownBrands());
}
