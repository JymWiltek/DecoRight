/**
 * Mutually-exclusive wording in product names. Jym-editable.
 *
 * Manufacturer spec sheets sometimes carry self-contradictory names — the one
 * that triggered this was "Wall Hung Counter Top Basin", which a basin cannot
 * be. The AI transcribes what it reads, so the contradiction was written
 * straight into the catalog and then fed the scene generator, which had to
 * pick a side and guessed wrong.
 *
 * This REPORTS, it never decides. A flagged name is still written (a bulk run
 * must not stall on a naming argument) and Jym adjudicates. Nothing here
 * renames anything or picks a winner.
 *
 * Scope is names only. Adding groups is enough to extend it — no code change.
 */

/** One group = one way of mounting something. Two different groups in the same
 *  name is the contradiction; two phrases from the SAME group is not
 *  ("Freestanding Pedestal Basin" is fine, both mean floor-standing). */
export type ConflictGroup = { label: string; phrases: string[] };

export const NAME_CONFLICT_GROUPS: ConflictGroup[] = [
  {
    label: "wall-hung",
    phrases: ["wall hung", "wall-hung", "wall mounted", "wall-mounted"],
  },
  {
    label: "counter-top",
    phrases: ["counter top", "counter-top", "countertop", "table top", "table-top"],
  },
  {
    label: "floor-standing",
    phrases: ["floor standing", "floor-standing", "freestanding", "free standing", "pedestal"],
  },
  {
    label: "semi-recessed",
    phrases: ["semi recessed", "semi-recessed"],
  },
];

export type NameConflict = {
  /** The groups the name matched, e.g. ["wall-hung", "counter-top"]. */
  groups: string[];
  /** The exact phrases that matched, for a message Jym can act on. */
  phrases: string[];
};

/**
 * Returns the conflict when a name mixes two or more mounting groups, or null.
 *
 * Matching is case-insensitive and whitespace-tolerant. Phrases are matched on
 * word boundaries so "pedestal" doesn't fire inside an unrelated word.
 */
export function findNameConflict(name: string | null | undefined): NameConflict | null {
  const n = (name ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!n) return null;

  const hitGroups: string[] = [];
  const hitPhrases: string[] = [];
  for (const g of NAME_CONFLICT_GROUPS) {
    const found = g.phrases.filter((p) => {
      const esc = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(^|[^a-z])${esc}([^a-z]|$)`).test(n);
    });
    if (found.length > 0) {
      hitGroups.push(g.label);
      hitPhrases.push(...found);
    }
  }
  return hitGroups.length >= 2
    ? { groups: hitGroups, phrases: hitPhrases }
    : null;
}

/** The operator-facing sentence, used by the bulk result panel and the note on
 *  the edit page. Same wording everywhere. */
export function nameConflictMessage(name: string, c: NameConflict): string {
  return `命名冲突:"${name}" 同时含互斥安装词(${c.phrases.join(" / ")}),请人工核对`;
}

/** Pseudo-key appended to products.missing_fields so the list can show a
 *  warning without a new column — the same channel `_low_confidence` and
 *  `publish_gate_*` already travel on. */
export const NAME_CONFLICT_KEY = "name_conflict";
