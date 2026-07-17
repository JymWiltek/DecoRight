import { dimensionCapFor } from "@config/dimension-caps";

export type Dims = { length?: number | null; width?: number | null; height?: number | null };

/**
 * PB4 item 5 (layer 2) — sanity-cap AI-extracted dimensions per item_type.
 * Any single axis over the category cap is DROPPED (left null) with a warning,
 * so a mis-read "6300 mm towel rack" never reaches AR. Empty axes always pass
 * (empty is honest). Unknown item_type → pass through + a soft note (new
 * categories aren't blocked). Applied ONLY when the AI writes new values — never
 * retroactively.
 *
 * Returns the filtered dims (a NEW object with only the within-cap axes) plus
 * human-readable warnings for the operator.
 */
export function guardDimensions(
  dims: Dims | null | undefined,
  itemType: string | null | undefined,
): { dims: Dims; warnings: string[] } {
  const out: Dims = {};
  const warnings: string[] = [];
  if (!dims) return { dims: out, warnings };

  const cap = dimensionCapFor(itemType);
  const axes: (keyof Dims)[] = ["length", "width", "height"];
  for (const axis of axes) {
    const v = dims[axis];
    if (v == null || !Number.isFinite(v) || v <= 0) continue; // empty axis → skip (honest)
    if (cap != null && v > cap) {
      warnings.push(
        `${axis} ${v} mm exceeds the ${itemType} cap (${cap} mm) — looks mis-read, left blank.`,
      );
      continue; // drop the absurd axis
    }
    out[axis] = v;
  }
  if (cap == null && itemType && Object.keys(out).length > 0) {
    warnings.push(
      `no dimension cap configured for item_type "${itemType}" — values kept as-is (add one in config/dimension-caps.ts).`,
    );
  }
  return { dims: out, warnings };
}
