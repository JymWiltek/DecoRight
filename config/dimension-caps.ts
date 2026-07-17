/**
 * Per-item-type sanity caps for AI-extracted dimensions (mm, any single axis).
 *
 * The SECOND (backstop) layer of the "no absurd dimensions" guard. The first
 * layer is the AI prompt ("read a real printed number or leave it null"). This
 * catches the cases that still slip through: a range hood at 6300 mm is not a
 * range hood measurement, so we DROP that axis + record a warning rather than
 * ship a 6-metre AR model.
 *
 * Rules (enforced in lib/admin/dimension-guard.ts):
 *   • axis value > cap        → drop THAT axis (leave null) + warn.
 *   • empty / null axis       → always allowed (empty is honest).
 *   • item_type NOT in table  → pass through + a soft note (new categories
 *                               are added over time; never block on absence).
 *   • only applied on AI WRITE — never retroactively to existing products.
 *
 * Jym owns these numbers — edit them here (one file, no code changes needed
 * elsewhere). Values are the largest plausible single dimension for the
 * category, with generous headroom.
 */
export const DIMENSION_CAP_MM: Record<string, number> = {
  faucet: 800,
  toilet: 1000,
  basin: 1200,
  dining_chair: 1200,
  bathroom_equipments: 1500,
  sink: 1500,
  range_hood: 1500,
  vanity: 2000,
  bathtub: 2200,
  shower: 2500,
  bathroom_vanity: 2500,
  bed_frame: 2500,
  dining_table: 3000,
  sofa: 4500,
};

/** Cap for an item_type, or null when the category isn't listed (→ no cap,
 *  pass through). */
export function dimensionCapFor(
  itemType: string | null | undefined,
): number | null {
  if (!itemType) return null;
  return DIMENSION_CAP_MM[itemType] ?? null;
}
