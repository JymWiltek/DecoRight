/**
 * Mounting → scene constraint. Jym-editable, same pattern as
 * config/dimension-caps.ts.
 *
 * Why this exists: the scene generator kept installing products wrongly — a
 * wall-hung basin standing on a countertop, a corner shelf sitting on a table.
 * The prompt's old `surfaceHint` guessed the surface from item_type plus a
 * regex over the product NAME, so a wall-mounted basin only got the right
 * instruction if someone had happened to type "wall hung" into its name. The
 * structured field that actually knows the answer — attributes.mounting — was
 * never read. These rules are injected as a hard requirement instead.
 *
 * KEYS MUST BE REAL `products.attributes.mounting` VALUES. As of writing the
 * catalog contains exactly: counter_top (39), wall_mounted (20),
 * floor_standing (12), deck_mounted (5), semi_recessed (2), built_in (1).
 * Adding a key for a value nothing carries does nothing until products use it.
 *
 * Wording guidance: say where the product touches the world and, just as
 * importantly, what must NOT be under/around it — the failures were all the
 * model inventing a support that shouldn't be there.
 */
export const MOUNTING_SCENE_RULES: Record<string, string> = {
  wall_mounted:
    "INSTALLATION (mandatory): the product is fixed DIRECTLY to the wall and " +
    "cantilevers off it. The space underneath the product must be COMPLETELY " +
    "EMPTY — no countertop, no vanity, no cabinet, no pedestal, no legs and no " +
    "surface of any kind supporting it from below. Do not place it on furniture.",

  counter_top:
    "INSTALLATION (mandatory): the product sits ON TOP of a countertop, its " +
    "whole base resting on the counter surface, in full contact with it. It is " +
    "not recessed into the counter and not mounted on the wall.",

  // Hardened after review: the positive-only wording let the model drift back
  // to a counter-top bowl (it "complies" by placing the basin near the edge).
  // Stating what must NOT be visible is what actually holds it.
  semi_recessed:
    "INSTALLATION (mandatory): the product is SEMI-RECESSED. Its lower half " +
    "sinks DOWN INTO a cut-out in the countertop, so only the upper part and " +
    "the rim rise above the counter surface, and the front portion protrudes " +
    "out past the counter edge. " +
    "FORBIDDEN: do NOT show the whole basin sitting on top of the counter; do " +
    "NOT show the underside or the lower half of the basin; do NOT show the " +
    "basin merely resting on the counter as a separate object stacked on it. " +
    "The counter surface must visibly cut across the basin body.",

  floor_standing:
    "INSTALLATION (mandatory): the product stands DIRECTLY on the floor, its " +
    "base in contact with the floor. It is not on a plinth, table or counter " +
    "and it is not attached to the wall.",

  deck_mounted:
    "INSTALLATION (mandatory): the product is mounted THROUGH the deck — it " +
    "rises out of a hole in the countertop or in the rim of the basin/sink, " +
    "with its base flush against that surface. It is not wall-mounted and does " +
    "not simply stand loose on the counter.",

  built_in:
    "INSTALLATION (mandatory): the product is recessed INTO the wall or into " +
    "cabinetry so that only its front face is exposed, sitting flush with the " +
    "surrounding surface. No part of the body protrudes into the room.",

  // Requested by Jym for the corner-shelf failure. NOTHING in the catalog
  // carries mounting='corner' today (both Corner Shelf rows are wall_mounted
  // or blank), so this rule is inert until products are tagged with it — it is
  // here so tagging one is all that's needed, no code change.
  corner:
    "INSTALLATION (mandatory): the product is fitted into the internal angle " +
    "where TWO WALLS MEET, touching both wall faces, with empty space below it. " +
    "It must not be placed on a table, counter, shelf or any other furniture.",
};

/**
 * subtype_slug → mounting, used ONLY when a product has no explicit
 * attributes.mounting. Keys are real subtype slugs in the taxonomy.
 * Deliberately conservative: a subtype is only mapped when it unambiguously
 * determines how the thing is installed.
 */
export const SUBTYPE_IMPLIES_MOUNTING: Record<string, string> = {
  counter_top: "counter_top",
  wall_hung: "wall_mounted",
  wall_mounted: "wall_mounted",
  semi_recessed: "semi_recessed",
  freestanding: "floor_standing",
  free_standing: "floor_standing",
  close_coupled: "floor_standing",
};

export type MountingResolution =
  /** A rule was found — inject `constraint`. */
  | { kind: "rule"; mounting: string; source: "mounting" | "subtype"; constraint: string }
  /** The product declares a mounting we have no rule for. Generation still
   *  runs (long tail must not be blocked), but the caller reports it so the
   *  table can be extended. */
  | { kind: "no_rule"; mounting: string }
  /** No mounting and no subtype that implies one — the caller BLOCKS, because
   *  generating here is exactly how wrong installations get produced. */
  | { kind: "unknown" };

/** Single place that answers "how is this product installed, and what must the
 *  scene prompt therefore say?". Used by the generator and by the pre-flight
 *  check that decides whether a product may be queued at all. */
export function resolveMountingRule(
  mounting: string | null | undefined,
  subtypeSlug: string | null | undefined,
): MountingResolution {
  const m = (mounting ?? "").trim();
  if (m) {
    const constraint = MOUNTING_SCENE_RULES[m];
    return constraint
      ? { kind: "rule", mounting: m, source: "mounting", constraint }
      : { kind: "no_rule", mounting: m };
  }
  const sub = (subtypeSlug ?? "").trim();
  const implied = sub ? SUBTYPE_IMPLIES_MOUNTING[sub] : undefined;
  if (implied && MOUNTING_SCENE_RULES[implied]) {
    return {
      kind: "rule",
      mounting: implied,
      source: "subtype",
      constraint: MOUNTING_SCENE_RULES[implied],
    };
  }
  return { kind: "unknown" };
}
