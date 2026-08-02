/**
 * Scene STYLE config — Jym-editable. Two layers on top of the PLACEMENT rules
 * in mounting-scene-rules.ts:
 *
 *   1. SCENE_PALETTE_POOLS — material class → a POOL of background scenes. One
 *      scene is picked per product (seeded by id, so a batch spreads out)
 *      instead of one fixed look. The white-ceramic pool is deliberately
 *      VARIED (not all warm-beige) — that monotone was the "太 AI" complaint,
 *      and ~9/10 toilets are white ceramic so they all landed in one look.
 *
 *   2. SCENE_PROP_RULES — bathroom scenes get real Southeast-Asian accessories
 *      (bidet spray, paper holder, towel rail…), and — when the catalog has
 *      matching accessory products — those products' photos are fed to the
 *      generator as a style reference, so what appears in the scene is
 *      something DecoRight actually sells.
 *
 * Material-class keys come from classify() in scene-cover.ts:
 *   warm    = white ceramic / light products   (the big, must-be-varied pool)
 *   cool    = dark / metal
 *   luxury  = gold / brass
 *   neutral = colourful products
 * Add / remove pool entries freely — docs/scene-rules.md re-exports on build.
 */

export const SCENE_PALETTE_POOLS: Record<string, string[]> = {
  // WHITE CERAMIC / light products. Five genuinely different real-bathroom
  // looks (warm wood, cool concrete, dark floor, terrazzo, soft-colour walls)
  // so a page of white toilets stops reading as one AI room.
  warm: [
    "a warm Scandinavian bathroom with light oak, warm-white plaster walls and soft diffused daylight",
    "a cool grey bathroom with raw concrete and microcement walls, dark-grout tile and cool north light",
    "a bright white-tiled bathroom with a DARK stone floor and warm accent lighting",
    "a terrazzo bathroom with speckled terrazzo floor and walls and soft even daylight",
    "a calm bathroom with pale sage-green plaster walls, light travertine floor and gentle diffused daylight",
  ],
  // DARK / metal products.
  cool: [
    "a cool modern bathroom with matte pale-grey stone and concrete, crisp cool-white daylight",
    "a contemporary bathroom with raw concrete and charcoal microcement walls, soft cool north light",
    "a moody dark bathroom with deep charcoal stone walls and low-key dramatic lighting",
    "a minimalist industrial bathroom with brushed grey concrete, dark-grout tile and neutral cool light",
  ],
  // GOLD / brass products.
  luxury: [
    "a dark luxury bathroom with near-black marble walls and warm low-key lighting",
    "a warm boutique bathroom with deep taupe walls, walnut cabinetry and soft warm pooled light",
    "an elegant neutral bathroom with soft greige stone walls and even refined daylight",
    "a boutique-hotel bathroom in dark green-black marble with warm pooled light",
  ],
  // COLOURFUL products — a clean neutral gallery so the colour reads true.
  neutral: [
    "a clean neutral gallery-like bathroom with soft light-grey walls and even shadowless daylight",
    "a minimal studio-like bathroom with off-white walls, pale grey floor and bright even light",
    "an airy neutral bathroom with white plaster walls, light grey stone and soft cool-neutral daylight",
  ],
};

/** Living-room scenes for sofas etc. (one per material class — not the toilet
 *  monotone problem, so kept as a single look each). */
export const LIVING_SCENES: Record<string, string> = {
  warm: "a bright Scandinavian living room with warm white walls, light oak floor and a large window",
  cool: "a cool modern living room with grey concrete walls, matte flooring and soft cool daylight",
  luxury: "a dark luxury living room with charcoal walls, walnut and warm gold accent lighting",
  neutral: "a clean neutral living room with soft light-grey walls and even daylight",
};

/** Kitchen scenes for range hoods etc. — a hood belongs over a cooktop, never
 *  in a bathroom. */
export const KITCHEN_SCENES: string[] = [
  "a modern kitchen with matte pale-grey cabinetry, a cooktop directly below and soft cool daylight",
  "a contemporary kitchen with warm wood cabinets, a stone backsplash, a cooktop directly below and gentle warm light",
  "a sleek dark kitchen with charcoal cabinetry, a cooktop directly below and moody low-key lighting",
  "a minimalist kitchen with white cabinets, a concrete counter, a cooktop directly below and clean cool daylight",
];

/** SINGLE resolver: material class + item_type → the background-scene POOL to
 *  pick from. The one place that decides which pool a product draws on. */
export function resolveScenePalettePool(
  tone: string,
  itemType: string | null,
): string[] {
  const it = itemType ?? "";
  if (/range_hood/.test(it)) return KITCHEN_SCENES;
  if (/sofa|dining_table|dining_chair|bed_frame|cabinet|console/.test(it))
    return [LIVING_SCENES[tone] ?? LIVING_SCENES.neutral];
  return SCENE_PALETTE_POOLS[tone] ?? SCENE_PALETTE_POOLS.warm;
}

/**
 * Background-prop layer, by item_type. IRON LAW (Jym, PB — reversal of #29):
 * "See it, buy it" — a prop the customer can't actually buy is WORSE than an
 * empty wall. So each prop is injected ONLY when the catalog has a real
 * accessory of `referenceItemType` WITH a white-bg photo to feed as a style
 * reference. No reference ⇒ the prop is dropped entirely. There is NO text-only
 * fallback (the old "just draw a towel rack" path is deleted — that produced the
 * invented, unbuyable props).
 *
 * Each prop is ALSO rolled independently by `probability` (seeded per product),
 * so scenes vary: some props, some none, never a full-house every time, and
 * never two of the same type. A zero-prop clean scene is a valid outcome.
 */
export type ScenePropSpec = {
  /** stable key — dedup + seed salt so the roll is reproducible per product. */
  key: string;
  /** prompt phrase for this single prop. */
  label: string;
  /** independent chance (0..1) this prop appears. Jym-editable. */
  probability: number;
  /** catalog item_type that must have a white-bg product for this prop to be
   *  drawn (and whose photo is fed as the reference). */
  referenceItemType: string;
};

export const SCENE_PROP_RULES: Record<string, ScenePropSpec[]> = {
  toilet: [
    { key: "spray", label: "a bidet spray hose mounted on the wall beside the toilet", probability: 0.6, referenceItemType: "bathroom_equipments" },
    { key: "paper_holder", label: "a wall-mounted toilet-paper holder with a paper roll on it", probability: 0.5, referenceItemType: "bathroom_equipments" },
    { key: "towel", label: "a towel rail or rack on the wall holding a folded towel", probability: 0.3, referenceItemType: "bathroom_equipments" },
  ],
  basin: [
    { key: "towel", label: "a towel rail or rack on the wall holding a folded towel", probability: 0.3, referenceItemType: "bathroom_equipments" },
    { key: "shelf", label: "a small wall shelf beside the basin", probability: 0.3, referenceItemType: "bathroom_equipments" },
  ],
  // vanity keeps a mirror — but under the SAME iron law: it appears only when a
  // real mirror product (item_type 'mirror') has a white-bg photo. No mirror
  // product ⇒ no invented mirror. Keyed for both vanity item_type values.
  bathroom_vanity: [
    { key: "mirror", label: "a wall mirror mounted on the wall directly above the basin", probability: 0.9, referenceItemType: "mirror" },
    { key: "towel_ring", label: "a towel ring on the wall with a hand towel", probability: 0.3, referenceItemType: "bathroom_equipments" },
  ],
  vanity: [
    { key: "mirror", label: "a wall mirror mounted on the wall directly above the basin", probability: 0.9, referenceItemType: "mirror" },
    { key: "towel_ring", label: "a towel ring on the wall with a hand towel", probability: 0.3, referenceItemType: "bathroom_equipments" },
  ],
  // NOTE: faucet has NO prop spec here. Its water-catching basin/sink is the
  // product's PHYSICAL SUPPORT, not a decorative prop — it is written into the
  // UNCONDITIONAL faucet item_type rule (FAUCET_RULES in mounting-scene-rules)
  // and drawn even when the catalog has no reference (the "no ref ⇒ no prop"
  // iron law does NOT apply to a mandatory support fixture). The optional
  // reference IMAGE is resolved separately in maybeGenerateSceneCover.
};

/** Deterministic [0,1) from a string — for seeded, reproducible prop rolls. */
function hashUnit(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

export type SelectedProp = { key: string; label: string; referenceProductId: string };

/**
 * THE single prop resolver (pure — dry-run testable). For each spec: roll the
 * seeded probability AND require a real reference (`refsByType[referenceItemType]`
 * non-empty) — either fails ⇒ the prop is dropped (iron law: no ref, no prop;
 * no text-only fallback). Selected props each get a reference product id
 * (rotated by seed). Result may be EMPTY (a clean, zero-prop scene is valid).
 */
export function pickSceneProps(
  specs: ScenePropSpec[],
  seed: string,
  refsByType: Record<string, string[]>,
): SelectedProp[] {
  const out: SelectedProp[] = [];
  const usedKeys = new Set<string>();
  for (const spec of specs) {
    if (usedKeys.has(spec.key)) continue; // never two of the same type
    const refs = refsByType[spec.referenceItemType] ?? [];
    if (refs.length === 0) continue; // NO reference ⇒ drop the prop
    if (hashUnit(`${seed}:${spec.key}`) >= spec.probability) continue; // roll
    usedKeys.add(spec.key);
    out.push({
      key: spec.key,
      label: spec.label,
      referenceProductId: refs[Math.floor(hashUnit(`${seed}:ref:${spec.key}`) * refs.length)],
    });
  }
  return out;
}

/**
 * Scene-coverage QC range (PB #33). After a scene image is generated we ask a
 * vision model what % of the frame the product occupies; a good scene keeps the
 * product between these bounds. Out-of-range → the image is flagged unqualified
 * (not counted as a publishable scene) and the admin shows the number. Jym
 * tunes these against real images. This SUPERSEDES the earlier 80/20 TODO.
 */
export const SCENE_COVERAGE_RANGE = { min: 30, max: 60 } as const;

/** Single reader for the prop layer. [] when this item_type has no prop specs. */
export function resolveScenePropSpecs(
  itemType: string | null | undefined,
): ScenePropSpec[] {
  const t = (itemType ?? "").trim();
  return (t && SCENE_PROP_RULES[t]) || [];
}
