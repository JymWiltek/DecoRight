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
 *   • no brands table and no config word list — the match set is simply the
 *     distinct brands already on products;
 *   • no "unknown brand" rejection — a genuinely new brand is stored verbatim.
 *     This only collapses CASE variants of brands we already carry.
 *
 * The rule lives once in `normalizeBrandAgainst`. Single-row callers use
 * `normalizeBrand`; batch callers (Excel import) load the known set once and
 * call the pure function per row so an N-row import is still one query.
 */

/** Distinct non-empty brands currently stored on products, in the order the
 *  DOMINANT casing should win (see normalizeBrandAgainst). */
export async function loadKnownBrands(): Promise<string[]> {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from("products")
    .select("brand")
    .not("brand", "is", null);

  // Count each exact casing, then keep the most frequently used spelling per
  // case-insensitive key. The catalog already contains both SANIWARE and
  // Saniware; without a tie-break the "existing casing" would depend on row
  // order. Most-used wins, first-seen breaks ties — deterministic either way.
  const counts = new Map<string, Map<string, number>>();
  const firstSeen = new Map<string, number>();
  let i = 0;
  for (const row of data ?? []) {
    const raw = (row.brand ?? "").trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    if (!counts.has(key)) {
      counts.set(key, new Map());
      firstSeen.set(key, i++);
    }
    const per = counts.get(key)!;
    per.set(raw, (per.get(raw) ?? 0) + 1);
  }

  const winners: string[] = [];
  for (const [, per] of counts) {
    let best = "";
    let bestN = -1;
    for (const [spelling, n] of per) {
      if (n > bestN) {
        best = spelling;
        bestN = n;
      }
    }
    winners.push(best);
  }
  return winners;
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
