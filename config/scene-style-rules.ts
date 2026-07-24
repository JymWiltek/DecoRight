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

/** Background-prop layer, by item_type. `guidance` is the text always injected;
 *  `referenceItemTypes` are the catalog item_types whose real products we feed
 *  as a style reference when we have them. Jym-editable. */
export type ScenePropRule = {
  guidance: string;
  /** Catalog item_types to pull real accessory products from as references. */
  referenceItemTypes: string[];
};

export const SCENE_PROP_RULES: Record<string, ScenePropRule> = {
  toilet: {
    guidance:
      "wall-visible Southeast-Asian bathroom accessories — a bidet spray hose on the wall beside the toilet, a wall-mounted toilet-paper holder, and a towel rail/rack",
    referenceItemTypes: ["bathroom_equipments"],
  },
  basin: {
    guidance:
      "wall-visible Southeast-Asian bathroom accessories — a towel rail/rack and a small wall shelf",
    referenceItemTypes: ["bathroom_equipments"],
  },
};

/** Single reader for the prop layer. null when this item_type has no rule. */
export function resolveScenePropRule(
  itemType: string | null | undefined,
): ScenePropRule | null {
  const t = (itemType ?? "").trim();
  return (t && SCENE_PROP_RULES[t]) || null;
}
