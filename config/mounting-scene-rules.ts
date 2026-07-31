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
 * SECOND placement layer — by item_type. Jym-editable.
 *
 * Why a second layer: mounting alone is not enough. `floor_standing` tells a
 * toilet and a sofa the exact same thing ("stands on the floor"), but a toilet
 * has a soil pipe out of its back, so it MUST sit against a wall; a sofa
 * doesn't. That orientation-in-the-room rule belongs to the item_type, not the
 * mounting, so it lives here and is injected AFTER the mounting constraint.
 *
 * KEYS ARE `products.item_type` VALUES. This layer is grown ONE category at a
 * time as scene errors show up (Jym's cadence). An item_type with no entry
 * here injects nothing and does not error — the mechanism is ready for every
 * category; the wording is filled in per-category. Only `toilet` today.
 *
 * Wording: same hardened范式 as semi_recessed — a positive requirement AND an
 * explicit FORBIDDEN list, because the failures were the model inventing a
 * placement (toilet floating mid-room, back off the wall).
 */
/**
 * Mounting heights (mm above finished floor) for the accessory scene rules.
 * Pulled out as named numbers so Jym can retune "how high" without touching the
 * rule prose. Values are the mid-point of the range Jym specified. Referenced
 * inside ITEM_TYPE_SCENE_RULES below (declared first — a `const` is not hoisted,
 * so the rule object must be able to read it at module-load time).
 */
export const MOUNTING_HEIGHT_MM = {
  urinal: 600,
  paper_holder: 700, // Jym's 650–750 mm range, mid-point
  towel_shelf: 1550, // Jym's 1500–1600 mm range, mid-point
  faucet_above_basin_mm: 250, // spout above basin rim (Jym's 200–300 range)
} as const;

export const ITEM_TYPE_SCENE_RULES: Record<string, string> = {
  toilet:
    "PLACEMENT (mandatory): the toilet's BACK — its cistern/tank and rear face " +
    "— must sit FLUSH AGAINST A WALL, in full contact with it, because the " +
    "soil/waste pipe exits the back into the wall. " +
    "FORBIDDEN: do NOT place the toilet in the middle of the room; do NOT float " +
    "it at an angle or diagonally away from the walls; do NOT leave any gap " +
    "between its back and the wall; do NOT place it on a countertop, vanity or " +
    "any raised surface. It stands on the floor with its back flush to the wall.",

  // Three bathroom-accessory rules added after the urinal/paper-holder/towel
  // scenes came back wrong (urinal in a wood-panelled hallway, paper holder
  // styled on a cement counter with soap). NOTE: no product in the catalog
  // actually carries item_type='urinal' / 'paper_holder' / 'towel_shelf' today —
  // they are all item_type='bathroom_equipments' (verified by grep). These keys
  // are therefore reached via the NAME sub-classifier below (ACCESSORY_NAME_TO_
  // RULE). Keying them by their eventual item_type means that when the taxonomy
  // is later split (option B), item_type matches directly and the classifier
  // goes inert — no rule rewrite. The MOUNTING_HEIGHT_MM constants keep the
  // Jym-editable "how high off the floor" numbers in one obvious place.
  urinal:
    "BATHROOM CONTEXT (mandatory): a real bathroom with tiled or waterproof " +
    "walls. The urinal is fixed to the wall with its BACK flush against it; the " +
    `bowl/rim sits about ${MOUNTING_HEIGHT_MM.urinal} mm above the floor, and the ` +
    "floor below it reads as a wet-area with a visible floor drain / drainage " +
    "context. " +
    "FORBIDDEN: do NOT render a domestic hallway, wood-floor or bedroom look; do " +
    "NOT put it on open wooden shelving dressed with towels and plants; do NOT " +
    "float it in the middle of the room; do NOT place it on a countertop.",

  paper_holder:
    "BATHROOM CONTEXT (mandatory): mounted on the wall within arm's reach of a " +
    `toilet, about ${MOUNTING_HEIGHT_MM.paper_holder} mm above the floor, and by ` +
    "default LOADED with a paper roll. " +
    "PREFERRED (not required): let the edge of the frame catch a corner of the " +
    "toilet's side, so the bathroom context reads as real. " +
    "FORBIDDEN: do NOT place it above a countertop; do NOT stage it on a cement " +
    "counter with soap like a magazine styled-shoot; do NOT render it with no " +
    "bathroom context around it.",

  towel_shelf:
    "BATHROOM CONTEXT (mandatory): mounted on the wall, about " +
    `${MOUNTING_HEIGHT_MM.towel_shelf} mm above the floor, and by default DRAPED ` +
    "with a folded towel. " +
    "PREFERRED (not required): a wall near the shower area or beside the " +
    "washbasin. " +
    "FORBIDDEN: do NOT stand it on a countertop or on the floor; do NOT render a " +
    "bedroom / hallway wooden-shelf look; do NOT pile it with clutter as if it " +
    "were a general storage rack.",

  // faucet is a real item_type (32 products — grep). ONE rule covers both
  // wall-mounted and deck-mounted (the MOUNTING layer already sets body support:
  // wall-mounted = fixed to wall / deck-mounted = through the deck). What the
  // item_type rule adds is the water-catching basin — the #3 bug was a
  // wall-mounted faucet on a bare wall with nothing beneath it. A real basin is
  // also fed as a reference prop (see faucet in SCENE_PROP_RULES).
  faucet:
    "PLACEMENT (mandatory): a faucet ONLY makes sense over a basin/sink that " +
    "catches its water. There MUST be a wash basin or sink DIRECTLY BELOW the " +
    `spout, with the spout about ${MOUNTING_HEIGHT_MM.faucet_above_basin_mm} mm ` +
    "above the basin rim. For a WALL-MOUNTED faucet the basin sits on a counter/" +
    "vanity below the projecting spout; for a DECK-MOUNTED faucet the faucet " +
    "rises from the counter or the basin's own rim with the bowl right below/" +
    "behind it. Bathroom or kitchen context. " +
    "FORBIDDEN: do NOT show the faucet on a bare wall with nothing beneath it; do " +
    "NOT leave the area under the spout empty with no basin/sink; do NOT render " +
    "it on the floor or as a decorative object with no water-catching fixture.",
};

/**
 * NAME → item_type-rule-key sub-classifier. ONLY consulted when a product's own
 * item_type has no direct ITEM_TYPE_SCENE_RULES entry. Today every urinal /
 * paper holder / towel accessory ships as item_type='bathroom_equipments' (one
 * shared bucket — see the grep note above), so the product NAME is the only
 * signal that separates them. Order matters: first regex to match wins.
 *
 * TODO(option B — taxonomy split): give these their own item_type values
 * (urinal / paper_holder / towel_rail) and delete this table — resolve then
 * matches on item_type directly. Until then, name is all we have.
 */
const ACCESSORY_NAME_TO_RULE: { test: RegExp; key: string }[] = [
  { test: /urinal/i, key: "urinal" },
  { test: /paper\s*holder|toilet\s*paper/i, key: "paper_holder" },
  { test: /towel/i, key: "towel_shelf" }, // rack / shelf / rail / bar
];

/** Single reader for the item_type placement layer. Returns the rule string or
 *  null when neither the item_type NOR the product name maps to a rule (→ inject
 *  nothing, never error). `name` is consulted only as a fallback for the shared
 *  'bathroom_equipments' bucket, where item_type can't tell urinal from paper
 *  holder from towel rail. */
export function resolveItemTypeSceneRule(
  itemType: string | null | undefined,
  name?: string | null | undefined,
): string | null {
  const t = (itemType ?? "").trim();
  if (t && ITEM_TYPE_SCENE_RULES[t]) return ITEM_TYPE_SCENE_RULES[t];
  const n = (name ?? "").trim();
  if (n) {
    for (const { test, key } of ACCESSORY_NAME_TO_RULE) {
      if (test.test(n)) return ITEM_TYPE_SCENE_RULES[key] ?? null;
    }
  }
  return null;
}

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

/**
 * mounting VALUE aliases → the canonical MOUNTING_SCENE_RULES key. Some products
 * carry a synonym in attributes.mounting that isn't itself a rule key — e.g.
 * `wall_hung` (7 products) means the same as the canonical `wall_mounted`. Before
 * this table those rows resolved to `unknown` and generated WITHOUT an
 * installation constraint (a wall-hung cabinet drawn standing on the floor). All
 * normalisation flows through resolveMountingRule (the single entry) — never
 * inline a `=== "wall_hung"` anywhere. Add a new synonym here as one line.
 */
export const MOUNTING_ALIASES: Record<string, string> = {
  wall_hung: "wall_mounted",
};

/** Longest-edge size tiers → a RELATIVE phrasing appended to the real-size
 *  clause. Image models don't reason about millimetre numbers (a 370 mm cabinet
 *  still got drawn filling a wall), so the mm value is kept AND translated into
 *  "how much of the room it should occupy". Thresholds + wording Jym-editable;
 *  `maxMm` is the inclusive upper bound of each tier (last tier = Infinity). */
export const SCENE_SIZE_TIERS: { maxMm: number; phrasing: string }[] = [
  {
    maxMm: 500,
    phrasing:
      "This is a compact fixture — it should occupy only a small portion of the wall; most of the wall remains empty.",
  },
  {
    maxMm: 1200,
    phrasing:
      "This is a medium-sized fixture in a normally proportioned room.",
  },
  {
    maxMm: Infinity,
    phrasing:
      "This is a large fixture, but the room is spacious enough that it does not dominate the frame.",
  },
];

/** The relative-size sentence for a product whose longest edge is `longestMm`.
 *  Single reader so the tiering can't drift between callers. */
export function resolveSizeTierPhrasing(longestMm: number): string {
  return (SCENE_SIZE_TIERS.find((t) => longestMm <= t.maxMm) ??
    SCENE_SIZE_TIERS[SCENE_SIZE_TIERS.length - 1]).phrasing;
}

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
  const raw = (mounting ?? "").trim();
  // Normalise synonyms (wall_hung → wall_mounted) FIRST, so an aliased value
  // resolves to its canonical rule instead of falling through to no_rule.
  const m = raw ? (MOUNTING_ALIASES[raw] ?? raw) : raw;
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
