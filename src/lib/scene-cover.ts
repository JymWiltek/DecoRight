import "server-only";

import sharp from "sharp";
import {
  resolveMountingRule,
  resolveItemTypeSceneRule,
  resolveSizeTierPhrasing,
  faucetKind,
  structuralIntegrityRule,
  VANITY_BASIN_TYPES,
} from "@config/mounting-scene-rules";
import {
  resolveScenePalettePool,
  resolveScenePropSpecs,
  pickSceneProps,
  type SelectedProp,
} from "@config/scene-style-rules";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { isSceneCoverUrl } from "@/lib/scene-cover-url";
import type { Dimensions } from "@/lib/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * Scene-cover engine (Wave 13, Mode A) — WHOLE-IMAGE generation.
 *
 * HARD RULE (Jym, permanent): the product is drawn INTO the scene by
 * gpt-image-1 (images.edit, no mask), so it genuinely sits on the
 * counter/floor with integrated perspective, shadow and lighting. The old
 * "empty scene + composite the cutout on top" method is DELETED — it made
 * floating ghost images (hovering product + fake ellipse shadow), worse than
 * a plain white background. Never reintroduce compositing here.
 *
 * Fidelity is enforced by a hard prompt constraint ("keep the product 100%
 * identical"). A cover that drifts is re-run individually — that is
 * acceptable; ghost images are not.
 *
 * Tone routing by primary colour/material stays (warm / cool / luxury /
 * neutral) — a fidelity aid too: a warm scene around a dark/colour product
 * skews how its colour reads.
 *
 * Stateless idempotency: "already scened" == thumbnail is a /scene- URL.
 */

const CW = 1024;
const CH = 1536;

type Tone = "warm" | "cool" | "luxury" | "neutral";

export function classify(colors: string[], name: string): Tone {
  const arr = (colors ?? []).map((c) => String(c).toLowerCase());
  const primary = arr[0] ?? "";
  const t = (primary + " " + name).toLowerCase();
  if (/blue|green|purple|violet|teal|pink|magenta|\bred\b|amber|turquoise|aqua|lilac|coral/.test(t))
    return "neutral";
  if (/gold|rose gold|rose_gold|\brose\b|brass|champagne|bronze/.test(t)) return "luxury";
  // White ceramic / wood furniture belongs to the light "warm" family even
  // when it has black/grey accents (a white vanity should sit in a light
  // room, not a dark one). Only truly dark/metal products go "cool".
  if (arr.includes("white")) return "warm";
  if (/black|dark|grey|gray|gunmetal|gun metal|graphite|charcoal|chrome|stainless|steel|nickel|silver/.test(t))
    return "cool";
  return "warm";
}

// Background-scene pools (material class → pool of scenes) + the SEA prop
// layer moved to config/scene-style-rules.ts (Jym-editable, re-exported to
// docs/scene-rules.md). scenePrompt picks one scene from the resolved pool via
// pickVariant, seeded per product so a batch spreads out.

function pickVariant(seed: string, arr: string[]): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return arr[h % arr.length];
}

/** Where the product physically belongs — so Mode A grounds it correctly. */
function surfaceHint(itemType: string | null, name: string): string {
  if (/range_hood/.test(itemType ?? ""))
    return "The product is mounted ON the kitchen wall directly above the cooktop or hob.";
  if (/wall.?hung|wall.?mount|壁挂/i.test(name)) return "The product is mounted ON the wall.";
  const it = itemType ?? "";
  if (/faucet|basin|sink|showerhead/.test(it))
    return "The product rests fully ON a countertop, sitting on the surface.";
  if (/shower/.test(it)) return "The product is mounted ON the wall.";
  if (/toilet|bidet|bathtub/.test(it)) return "The product stands fully ON the floor, grounded.";
  if (/sofa|bed_frame|cabinet/.test(it)) return "The product rests fully ON the floor.";
  if (/dining_table|dining_chair/.test(it)) return "The product stands fully ON the floor.";
  return "The product rests naturally ON the surface, fully grounded — not floating.";
}

/** Real-size injection — the SINGLE source of truth for BOTH the interception
 *  decision (null ⇒ the generator must skip, never guess) AND the wording.
 *
 *  Jym's locked rule (same one the AR GLB scaling already uses): only the
 *  longest edge is truly needed — the other axes are inferred from the product
 *  photo's own proportions. So the clause requires at least ONE axis: known
 *  axes get their real mm value, unknown axes are marked "infer from the product
 *  image". ONLY an all-blank product (no axis at all) blocks — there is then no
 *  real-size anchor and the model would invent the whole thing (the toilet-vs-
 *  room 忽大忽小 bug). dimensions_mm axes map to the storefront's W/D/H —
 *  length=width, width=depth, height=height (see PB1-3). */
export function sceneDimensionClause(
  dims: Dimensions | null | undefined,
): string | null {
  const ok = (v: number | undefined): v is number =>
    typeof v === "number" && Number.isFinite(v) && v > 0;
  const axes: { label: string; v: number | undefined }[] = [
    { label: "wide", v: dims?.length },
    { label: "deep", v: dims?.width },
    { label: "tall", v: dims?.height },
  ];
  const known = axes.filter((a) => ok(a.v)).map((a) => a.v as number);
  if (known.length === 0) return null; // all three empty → block
  const parts = axes.map((a) =>
    ok(a.v)
      ? `${a.v} mm ${a.label}`
      : `${a.label}: infer proportionally from the product image`,
  );
  // Relative-size phrasing keyed on the longest KNOWN edge — the mm numbers
  // alone don't stop the model drawing a 370 mm cabinet across a whole wall.
  const tierPhrasing = resolveSizeTierPhrasing(Math.max(...known));
  return (
    `REAL SIZE (mandatory): ${parts.join("; ")}. ` +
    `Render every axis given in mm at exactly that real-world scale relative to ` +
    `the room and to every adjacent object (walls, floor, doors, counters, props). ` +
    `For any axis marked "infer", keep it in natural proportion to the given ` +
    `axis using the product's own shape — do NOT enlarge or shrink the product; ` +
    `its proportions against the space must read as correct. ${tierPhrasing}`
  );
}

/** Exported so the prompt can be inspected / asserted without spending an
 *  image generation. Pure string building — every constraint is pre-resolved
 *  by the caller and injected in a FIXED order: mounting → item_type placement
 *  → real size. */
export function scenePrompt(
  itemType: string | null,
  name: string,
  tone: Tone,
  seed: string,
  /** Hard installation requirement from config/mounting-scene-rules, resolved
   *  from the product's mounting / subtype. When present it REPLACES the
   *  old surfaceHint guess — that guess is what put wall-hung basins on
   *  countertops, so keeping both would contradict itself. */
  mountingConstraint?: string | null,
  /** Second placement layer, resolved from ITEM_TYPE_SCENE_RULES by item_type
   *  (e.g. "toilet back must be against a wall"). null for item_types with no
   *  rule yet — nothing is injected. */
  itemTypeConstraint?: string | null,
  /** Real-size clause from sceneDimensionClause. The caller only reaches here
   *  when it's non-null (a missing size blocks generation upstream). */
  dimensionClause?: string | null,
  /** SEA background-prop段, built from SCENE_PROP_RULES by the caller (it also
   *  did the catalog reference lookup). null for item_types with no prop rule.
   *  Appended AFTER the #28 segments — it never touches placement/size. */
  propsClause?: string | null,
  /** Structural-integrity clause (structuralIntegrityRule). UNCONDITIONAL — the
   *  caller always supplies it (all item_types), so a detached/floating part or a
   *  wall-hung unit drawn with legs is forbidden every time. */
  structuralClause?: string | null,
): string {
  // Material class + item_type → background-scene pool (config), one picked by
  // the per-product seed so a batch of white toilets spreads across looks.
  const scene = pickVariant(seed, resolveScenePalettePool(tone, itemType));
  // Fixed order: mounting → item_type placement → real size → background props.
  // Empties dropped so a missing layer doesn't leave a double space.
  const constraints = [
    mountingConstraint ?? surfaceHint(itemType, name),
    structuralClause,
    itemTypeConstraint,
    dimensionClause,
    propsClause,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    `Place this exact product into ${scene}. ${constraints} ` +
    `The product must be genuinely INSTALLED in the scene — sitting/standing/mounted on the surface ` +
    `with correct perspective, natural contact shadows, and fully integrated lighting and reflections. ` +
    `It must NOT look pasted-on, floating, hovering, or tilted off the surface. ` +
    `CRITICAL: keep the product 100% identical — reproduce its shape and silhouette EXACTLY as in the ` +
    `reference image; do NOT change its design, structure, proportions or styling; same colour, material and ` +
    `every detail. Do NOT redesign, recolour or restyle it. You may add tasteful ambient props (a plant, ` +
    `folded towels, soap) and clearly-separate companion items, but never attach anything to the product or ` +
    `add anything that could be mistaken as part of it. Photorealistic, the product is the hero, clean minimal composition.`
  );
}

export type ScenePromptResult =
  /** Ready to generate. `note` carries a non-fatal remark (currently "this
   *  mounting has no scene rule yet"). `referenceProductIds` are the in-catalog
   *  accessory products the props段 referenced — the caller records them (the
   *  data基础 for a future "other products in this scene" link). */
  | { ok: true; prompt: string; note?: string; referenceProductIds: string[] }
  /** Blocked before generation — mounting or real size unknown. `reason` is the
   *  operator-facing skip message. */
  | { ok: false; reason: string };

/** Pre-resolved prop selection for buildScenePromptForProduct — the OUTPUT of
 *  pickSceneProps (probability + reference gating already applied by the
 *  caller). Each selected prop is backed by a REAL catalog reference product
 *  (iron law: no ref ⇒ the prop was already dropped, never text-only). May be
 *  empty (a clean zero-prop scene is valid). */
export type SceneProps = {
  props: SelectedProp[];
};

/**
 * THE single entry that turns a product row into its scene prompt — or a block
 * reason. Both the generator (maybeGenerateSceneCover) and the dry-run test go
 * through here, so the three injected segments, their ORDER (mounting →
 * item_type placement → real size), and the "don't guess, block instead"
 * interception can never diverge. Pure: no I/O, no OpenAI.
 */
export function buildScenePromptForProduct(
  product: {
    item_type: string | null;
    name: string;
    colors: string[] | null;
    attributes: Record<string, unknown> | null;
    subtype_slug: string | null;
    dimensions_mm: Dimensions | null;
  },
  seed: string,
  /** Pre-resolved by the caller (config guidance + catalog reference lookup).
   *  null / undefined ⇒ no prop rule for this item_type ⇒ no props段. */
  sceneProps?: SceneProps | null,
): ScenePromptResult {
  // ① mounting — unknown blocks (this is exactly how wrong installations were
  // produced: a wall-hung basin on a countertop).
  const mountingValue =
    product.attributes && typeof product.attributes === "object"
      ? ((product.attributes as Record<string, unknown>).mounting as
          | string
          | null
          | undefined)
      : null;
  const mount = resolveMountingRule(mountingValue, product.subtype_slug);
  // faucet exception (PB): the basin/sink iron law makes a faucet scene sensible
  // WITHOUT a mounting value, so an unknown-mounting faucet is NOT blocked —
  // the item_type rule below (FAUCET_RULES) supplies the placement. Every other
  // item_type still blocks on unknown mounting (that safety is unchanged).
  const isFaucet = (product.item_type ?? "").trim() === "faucet";
  if (mount.kind === "unknown" && !isFaucet) {
    return {
      ok: false,
      reason:
        "no mounting — fill Installation method (attributes.mounting) first, otherwise the scene will guess and get it wrong",
    };
  }

  // ③ real size — Jym's rule: only the longest edge is required, the rest are
  // inferred from the product photo's proportions (same as the AR GLB scaling).
  // Blocks ONLY when ALL THREE axes are empty — an all-blank product has no
  // real-size anchor at all and the model would invent the whole thing
  // (忽大忽小 toilet bug). Message unchanged (Jym).
  const dimensionClause = sceneDimensionClause(product.dimensions_mm);
  if (!dimensionClause) {
    return {
      ok: false,
      reason:
        "no dimensions — fill W/D/H (dimensions_mm) first; the scene must not guess the product's real size",
    };
  }

  // ② item_type placement — null for item_types with no rule yet (inject
  // nothing, never error). Name is passed so the shared 'bathroom_equipments'
  // bucket can be sub-classified into urinal / paper holder / towel rule.
  const itemTypeConstraint = resolveItemTypeSceneRule(
    product.item_type,
    product.name,
  );

  // ④ Background props (appended after #28's三段). IRON LAW: the caller already
  // dropped any prop with no real catalog reference AND rolled probability, so
  // `props` is exactly what to draw (possibly EMPTY = clean scene, no clause).
  // Every listed prop has a reference product image attached by the caller.
  const selectedProps = sceneProps?.props ?? [];
  const referenceProductIds = selectedProps.map((p) => p.referenceProductId);
  const propsClause =
    selectedProps.length > 0
      ? `BACKGROUND PROPS (secondary): the scene may also include ${selectedProps
          .map((p) => p.label)
          .join("; ")}. Model each accessory on the ATTACHED reference product ` +
        `photos — same type and family (these are real products we sell). Include ` +
        `at MOST ONE of each accessory type — never two towel racks, two holders, etc. ` +
        `These accessories are strictly SECONDARY and SMALL: the product is the hero ` +
        `and dominates the frame — props must not overlap, cover, touch or upstage it. ` +
        `EVERY item in the scene (the product AND every prop) must rest on a real ` +
        `support surface — placed on a counter/floor or fixed to wall hardware — ` +
        `nothing floats, hovers or is stuck to a blank wall.`
      : null;

  // Structural integrity — UNCONDITIONAL, all item_types. Wall/floor specifics
  // apply only when mounting is known (unknown → base connected/supported rule).
  const canonicalMount = mount.kind === "unknown" ? null : mount.mounting;
  const structuralClause = structuralIntegrityRule(canonicalMount);

  const tone = classify(product.colors ?? [], product.name);
  const prompt = scenePrompt(
    product.item_type,
    product.name,
    tone,
    seed,
    mount.kind === "rule" ? mount.constraint : null,
    itemTypeConstraint,
    dimensionClause,
    propsClause,
    structuralClause,
  );
  const note =
    mount.kind === "no_rule"
      ? `mounting "${mount.mounting}" has no scene rule — add one in config/mounting-scene-rules.ts (generated without an installation constraint)`
      : undefined;
  return { ok: true, prompt, note, referenceProductIds };
}

/**
 * Catalog reference lookup for the prop layer — the "道具 reference" resolver.
 * Returns up to `limit` published accessory products (id + their WHITE-BG
 * cutout shot) whose item_type is one of `referenceItemTypes`. We read the
 * cutout from product_images, NOT thumbnail_url: a published accessory's
 * thumbnail is its own /scene- cover, but the clean white-bg product shot Jym
 * wants as a style reference is the cutout row. Empty list ⇒ props段 degrades
 * to text-only. Ordered by id for a stable, deterministic pick. Impure.
 */
export async function findSceneReferenceProducts(
  supabase: SupabaseClient<Database>,
  referenceItemTypes: string[],
  limit = 3,
): Promise<{ id: string; url: string }[]> {
  if (referenceItemTypes.length === 0) return [];
  const { data: prods } = await supabase
    .from("products")
    .select("id")
    .eq("status", "published")
    .in("item_type", referenceItemTypes)
    .order("id", { ascending: true })
    .limit(limit * 4);
  const ids = (prods ?? []).map((p) => p.id);
  if (ids.length === 0) return [];

  const { data: imgs } = await supabase
    .from("product_images")
    .select("product_id, cutout_image_url, image_kind, state")
    .in("product_id", ids)
    .eq("state", "cutout_approved");

  // One clean white-bg cutout per product (image_kind='cutout', not a scene).
  const whiteBgByProduct = new Map<string, string>();
  for (const im of imgs ?? []) {
    const url = im.cutout_image_url;
    if (!url || im.image_kind !== "cutout" || isSceneCoverUrl(url)) continue;
    if (!whiteBgByProduct.has(im.product_id)) whiteBgByProduct.set(im.product_id, url);
  }

  const out: { id: string; url: string }[] = [];
  for (const id of ids) {
    const url = whiteBgByProduct.get(id);
    if (url) out.push({ id, url });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Mode A: put the product on a portrait white canvas, then let gpt-image-1
 * redraw the WHOLE frame with the product placed into a scene. No mask, no
 * compositing. The prompt is pre-assembled by buildScenePromptForProduct and
 * passed in — this function does image work + the OpenAI call only.
 */
export async function buildSceneCoverPng(
  sourceBytes: Uint8Array,
  prompt: string,
  /** White-bg accessory shots to feed as background-prop style references
   *  (the props段 tells the model to model props on them). Empty ⇒ single
   *  image, exactly as before. */
  referenceImages: Buffer[] = [],
): Promise<Buffer> {
  const prod = await sharp(Buffer.from(sourceBytes), { failOn: "none" })
    .flatten({ background: "#ffffff" })
    .trim({ threshold: 12 })
    .resize(Math.round(CW * 0.72), Math.round(CH * 0.62), {
      fit: "inside",
      withoutEnlargement: true,
    })
    .toBuffer();
  const pm = await sharp(prod).metadata();
  const left = Math.round((CW - (pm.width ?? 0)) / 2);
  const top = Math.round(CH * 0.5 - (pm.height ?? 0) / 2);
  const base = await sharp({
    create: { width: CW, height: CH, channels: 3, background: "#ffffff" },
  })
    .composite([{ input: prod, left, top }])
    .png()
    .toBuffer();

  return gptEditWholeImage(base, prompt, referenceImages);
}

/** gpt-image-1 images.edit with NO mask — whole-frame regeneration. When
 *  reference images are present they ride along as additional `image[]`
 *  entries (gpt-image-1 accepts multiple: the first is the frame being redrawn,
 *  the rest are style references). No references ⇒ the original single-image
 *  `image` field, byte-for-byte the proven path. */
async function gptEditWholeImage(
  baseBuf: Buffer,
  prompt: string,
  referenceImages: Buffer[] = [],
): Promise<Buffer> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not configured");
  const form = new FormData();
  form.set("model", "gpt-image-1");
  if (referenceImages.length === 0) {
    form.set("image", new Blob([baseBuf as BlobPart], { type: "image/png" }), "b.png");
  } else {
    form.append("image[]", new Blob([baseBuf as BlobPart], { type: "image/png" }), "base.png");
    referenceImages.forEach((buf, i) =>
      form.append("image[]", new Blob([buf as BlobPart], { type: "image/png" }), `ref${i}.png`),
    );
  }
  form.set("prompt", prompt);
  form.set("size", "1024x1536");
  form.set("quality", "medium");
  form.set("n", "1");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 180_000);
  try {
    const r = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: ctrl.signal,
    });
    const j = (await r.json()) as { data?: { b64_json?: string }[]; error?: unknown };
    if (!r.ok) throw new Error(JSON.stringify(j.error ?? j).slice(0, 200));
    const b64 = j.data?.[0]?.b64_json;
    if (!b64) throw new Error("no image returned");
    return Buffer.from(b64, "base64");
  } finally {
    clearTimeout(t);
  }
}

/**
 * Fetch an image URL and decide if it is a plain white/studio background — the
 * SINGLE white-bg detector shared by the publish gate and the admin (no inlined
 * copies). Pure pixel judgement (corner sampling via isWhiteBg), zero AI, zero
 * OpenAI. On ANY fetch/decode failure it returns FALSE (can't confirm white ⇒
 * treat as NOT white) so a transient error never false-blocks a real scene —
 * matches Jym's intent that real photos pass, white cutouts don't.
 */
export async function isWhiteBackgroundImage(
  url: string | null | undefined,
): Promise<boolean> {
  if (!url) return false;
  try {
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    return await isWhiteBg(buf);
  } catch {
    return false;
  }
}

/**
 * THE publish-gate scene test: does this cover URL qualify as a scene image?
 * Qualified = it is NOT a plain white background. Source-blind by design —
 * Jym's ruling — so a real scene PHOTO he uploaded counts exactly like an AI
 * /scene- cover; the only disqualifier implemented this round is white bg.
 *
 * The /scene- URL is a cheap short-circuit (an AI cover is white-free by
 * construction) that also skips a fetch; anything else is decided on pixels.
 * This is the ONE place the gate loaders call — isSceneCoverUrl stays the
 * cheap URL sub-check inside it, not a competing definition.
 *
 * TODO(deferred — needs a vision-model call, budget not approved by Jym):
 * the SECOND disqualifier is severe scale distortion — the product occupying
 * >80% or <20% of the frame is also "not a usable scene". Not implemented here
 * because a reliable subject-area estimate needs a vision model (pixel corner
 * sampling can't measure how much of the frame the product fills). When
 * approved, add the check alongside the white-bg one and keep this the single
 * entry.
 */
export async function hasQualifiedSceneCover(
  url: string | null | undefined,
): Promise<boolean> {
  if (!url) return false;
  if (isSceneCoverUrl(url)) return true; // AI cover — white-free by construction
  return !(await isWhiteBackgroundImage(url));
}

/**
 * Widened publish-gate scene test (Jym): the product has a usable scene if ANY
 * of these image URLs qualifies — an AI /scene- cover (white-free by
 * construction) or any non-white-background photo. The ALL-IMAGES counterpart
 * to hasQualifiedSceneCover, built for Jym's standard combo: a white-bg cover
 * (the storefront card wants it) with the real scene PHOTO sitting at slide
 * 2/3. Same single white-bg detector (isWhiteBackgroundImage) — no new
 * classifier, the qualification rule is #32 unchanged.
 *
 * Cost-shaped for the authoritative publish moment: a cheap no-fetch /scene-
 * pass runs first; then a pixel pass that SHORT-CIRCUITS on the first
 * non-white image — so a product with a real photo usually costs one fetch,
 * and only an all-white product pays to fetch every image. `isWhite` is
 * injectable purely so the gate logic is unit-testable without live fetches;
 * production always uses isWhiteBackgroundImage.
 */
export async function hasQualifiedSceneAmongImages(
  urls: (string | null | undefined)[],
  isWhite: (url: string) => Promise<boolean> = isWhiteBackgroundImage,
): Promise<boolean> {
  const candidates = urls.filter((u): u is string => !!u);
  // Cheap pass: an AI /scene- URL is white-free by construction — no fetch.
  for (const u of candidates) if (isSceneCoverUrl(u)) return true;
  // Pixel pass: first non-white photo wins; stop there.
  for (const u of candidates) {
    if (isSceneCoverUrl(u)) continue;
    if (!(await isWhite(u))) return true;
  }
  return false;
}

/**
 * PB — "does this image look like a spec sheet / document?" (single detector,
 * same family + discipline as isWhiteBackgroundImage). PURE pixel heuristic,
 * ZERO AI: a spec sheet is a light background densely covered by small dark
 * text/lines → very HIGH edge density on a bright field. A product photo has far
 * fewer, larger edges. CONSERVATIVE by design — only a clear document trips it;
 * anything ambiguous returns false (leave it to the operator). On fetch/decode
 * failure returns false (never mis-demote a real photo on a transient error).
 */
export async function isDocumentLikeImage(
  url: string | null | undefined,
): Promise<boolean> {
  if (!url) return false;
  try {
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    return await isDocumentLikeBuffer(buf);
  } catch {
    return false;
  }
}

/** Pixel core for isDocumentLikeImage — grayscale edge-density on a bright field. */
export async function isDocumentLikeBuffer(buf: Buffer): Promise<boolean> {
  const N = 160;
  const { data, info } = await sharp(buf, { failOn: "none" })
    .flatten({ background: "#ffffff" })
    .grayscale()
    .resize(N, N, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const g = (x: number, y: number) => data[(y * N + x) * ch];
  let sum = 0;
  let edges = 0;
  const total = N * N;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const v = g(x, y);
      sum += v;
      // horizontal + vertical neighbour gradient — a hard transition = an edge.
      const rx = x + 1 < N ? g(x + 1, y) : v;
      const by = y + 1 < N ? g(x, y + 1) : v;
      if (Math.abs(v - rx) > 45 || Math.abs(v - by) > 45) edges++;
    }
  }
  const brightness = sum / total; // 0..255
  const edgeRatio = edges / total;
  // Light field (paper) + very dense edges (text/lines). Thresholds tuned to be
  // conservative — a photo of a product rarely exceeds ~0.10 edge ratio.
  return brightness > 175 && edgeRatio > 0.18;
}

/**
 * Coverage QC (PB #33) — ask the cheapest vision tier (gpt-4o-mini) what % of
 * the frame the main product occupies. Returns 0–100. THROWS on API/parse
 * failure; the caller catches and records "unmeasured" (QC never blocks
 * generation). Own timeout AbortController — the same abort discipline the
 * image call uses — so a hung request can't wedge the pipeline.
 *
 * Real calls happen only on Jym's live Run-AI run; dev/tests mock global.fetch.
 */
export async function measureSceneCoverage(imageBytes: Buffer): Promise<number> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not configured");
  const dataUri = `data:image/png;base64,${imageBytes.toString("base64")}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60_000);
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 10,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  "This is a product catalog scene. Estimate what PERCENTAGE (0-100) of the " +
                  "total image area is occupied by the single main product/fixture (exclude " +
                  "props, walls, floor and background). Reply with ONLY an integer, no % sign, no words.",
              },
              { type: "image_url", image_url: { url: dataUri } },
            ],
          },
        ],
      }),
    });
    const j = (await r.json()) as {
      choices?: { message?: { content?: string } }[];
      error?: unknown;
    };
    if (!r.ok) throw new Error(JSON.stringify(j.error ?? j).slice(0, 200));
    const txt = j.choices?.[0]?.message?.content ?? "";
    const m = String(txt).match(/\d+(\.\d+)?/);
    if (!m) throw new Error(`unparseable coverage reply: ${String(txt).slice(0, 40)}`);
    return Math.max(0, Math.min(100, parseFloat(m[0])));
  } finally {
    clearTimeout(t);
  }
}

/** True iff the 4 corners are light + low-saturation + consistent — a
 *  white/studio product shot, not an already-styled render. */
export async function isWhiteBg(buf: Buffer): Promise<boolean> {
  const { data, info } = await sharp(buf)
    .flatten({ background: "#ffffff" })
    .resize(80, 80, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W = 80;
  const ch = info.channels;
  const px = (x: number, y: number) => {
    const i = (y * W + x) * ch;
    return [data[i], data[i + 1], data[i + 2]] as const;
  };
  const corners = [px(2, 2), px(77, 2), px(2, 77), px(77, 77), px(40, 2), px(2, 40)];
  const light = corners.every(([r, g, b]) => Math.min(r, g, b) >= 200);
  const lowSat = corners.every(([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b) <= 22);
  const lum = corners.map(([r, g, b]) => (r + g + b) / 3);
  const consistent = Math.max(...lum) - Math.min(...lum) <= 26;
  return light && lowSat && consistent;
}

export type SceneCoverResult =
  /** `note` carries a non-fatal remark for the caller to surface — currently
   *  "this mounting has no scene rule yet", so the long tail is generated but
   *  visible instead of silently unconstrained. */
  | { status: "done"; url: string; note?: string }
  | { status: "skipped"; reason: string };

/**
 * Generate + set a Mode-A scene cover for one product IF it is a white-bg
 * product shot with no scene cover yet. Idempotent + safe to re-fire; throws
 * on failure (caller logs; the white-bg thumbnail is left untouched).
 */
export async function maybeGenerateSceneCover(
  productId: string,
  opts?: { force?: boolean },
): Promise<SceneCoverResult> {
  // PB3-C A — force=true (the panel's "Regenerate existing scene images")
  // bypasses the "already has a scene cover" short-circuits so the operator
  // can deliberately overwrite. Same generation path either way.
  const force = opts?.force === true;
  const supabase = createServiceRoleClient();
  // Record the outcome so scene-gen failures are VISIBLE (no more silent
  // swallow). Ignores its own write error → no-ops safely if the
  // scene_cover_status column hasn't been migrated in yet (mig 0050).
  const setStatus = async (
    status: "pending" | "done" | "skipped" | "failed",
    error?: string,
  ): Promise<void> => {
    await supabase
      .from("products")
      .update({ scene_cover_status: status, scene_cover_error: error ?? null })
      .eq("id", productId);
  };
  const skip = async (reason: string): Promise<SceneCoverResult> => {
    await setStatus("skipped", reason);
    return { status: "skipped", reason };
  };

  const { data: product, error: pErr } = await supabase
    .from("products")
    .select("id,name,item_type,colors,thumbnail_url,attributes,subtype_slug,dimensions_mm")
    .eq("id", productId)
    .maybeSingle();
  if (pErr) throw new Error(`db read: ${pErr.message}`);
  if (!product) return { status: "skipped", reason: "product not found" };
  if (!product.thumbnail_url) return skip("no thumbnail");
  if (!force && isSceneCoverUrl(product.thumbnail_url))
    return skip("already a scene cover");

  const { data: imgs } = await supabase
    .from("product_images")
    .select("id,cutout_image_url,image_kind,is_primary")
    .eq("product_id", productId);
  const rows = imgs ?? [];
  if (
    !force &&
    rows.some(
      (r) =>
        r.image_kind === "real_photo" && isSceneCoverUrl(r.cutout_image_url),
    )
  )
    return skip("scene row exists");

  // Palette-pool seed: normal generation uses the product id (stable → a batch
  // spreads across looks). Regenerate (force) salts it with a fresh nonce so
  // the operator gets a DIFFERENT scene; a plain page refresh doesn't
  // regenerate, so the stored image stays put.
  const seed = force ? `${productId}:${Date.now()}` : productId;

  // Background props — IRON LAW resolution. Per prop type, look up REAL catalog
  // references (white-bg products); pickSceneProps then keeps only props that
  // (a) have a reference AND (b) win their seeded probability roll. No ref ⇒ the
  // prop is dropped (no text-only fallback). Result may be empty (clean scene).
  const specs = resolveScenePropSpecs(product.item_type);
  const refUrlById = new Map<string, string>();
  const refsByType: Record<string, string[]> = {};
  for (const t of [...new Set(specs.map((s) => s.referenceItemType))]) {
    const found = await findSceneReferenceProducts(supabase, [t]);
    refsByType[t] = found.map((r) => r.id);
    for (const r of found) refUrlById.set(r.id, r.url);
  }
  const selectedProps = pickSceneProps(specs, seed, refsByType);
  const sceneProps: SceneProps = { props: selectedProps };

  // faucet basin/sink reference (PB): the catching fixture is a MANDATORY support
  // written into the faucet item_type rule text (drawn even with no reference —
  // the "no ref ⇒ no prop" iron law does NOT apply). If the catalog HAS a real
  // matching fixture (kitchen → sink / basin → basin), feed its photo as a style
  // reference and record it. Separate from pickSceneProps (untouched).
  let faucetRefId: string | null = null;
  if ((product.item_type ?? "").trim() === "faucet") {
    const refType = faucetKind(product.name) === "kitchen" ? "sink" : "basin";
    const found = await findSceneReferenceProducts(supabase, [refType]);
    if (found.length > 0) {
      faucetRefId = found[0].id;
      refUrlById.set(found[0].id, found[0].url);
    }
  }

  // vanity/basin mandatory-fixture references (PB): a wash-basin's faucet and
  // the mirror above it are MANDATORY (drawn even with no reference — written
  // into VANITY_BASIN_RULE). If the catalog HAS a real faucet / mirror white-bg
  // product, feed its photo as a style reference + record it. Same reference
  // mechanism as the faucet fixture; separate from pickSceneProps.
  let vanityFaucetRefId: string | null = null;
  let vanityMirrorRefId: string | null = null;
  if (VANITY_BASIN_TYPES.has((product.item_type ?? "").trim())) {
    const f = await findSceneReferenceProducts(supabase, ["faucet"]);
    if (f.length > 0) {
      vanityFaucetRefId = f[0].id;
      refUrlById.set(f[0].id, f[0].url);
    }
    const m = await findSceneReferenceProducts(supabase, ["mirror"]);
    if (m.length > 0) {
      vanityMirrorRefId = m[0].id;
      refUrlById.set(m[0].id, m[0].url);
    }
  }

  // Prompt pre-flight — ONE entry (buildScenePromptForProduct) resolves
  // mounting + real size + item_type placement + props and assembles the
  // prompt, OR blocks. Runs BEFORE the source image is fetched, so a product
  // missing mounting/dimensions is rejected cheaply and can never guess.
  const promptResult = buildScenePromptForProduct(product, seed, sceneProps);
  if (!promptResult.ok) return skip(promptResult.reason);

  // Only tell the model to "model on the ATTACHED reference" when one is really
  // attached; append a line per mandatory-fixture reference that exists.
  const finalPrompt =
    promptResult.prompt +
    (faucetRefId
      ? " The wash basin/sink below the faucet — model it on the ATTACHED reference product photo (a real fixture we sell)."
      : "") +
    (vanityFaucetRefId
      ? " The faucet/mixer tap on the basin — model it on the ATTACHED reference product photo (a real faucet we sell)."
      : "") +
    (vanityMirrorRefId
      ? " The mirror above the basin — model it on the ATTACHED reference product photo (a real mirror we sell)."
      : "");
  const allRefIds = [
    ...promptResult.referenceProductIds,
    ...(faucetRefId ? [faucetRefId] : []),
    ...(vanityFaucetRefId ? [vanityFaucetRefId] : []),
    ...(vanityMirrorRefId ? [vanityMirrorRefId] : []),
  ];

  const srcUrl =
    rows.find((r) => r.is_primary && r.cutout_image_url)?.cutout_image_url ??
    rows.find((r) => r.image_kind === "cutout" && r.cutout_image_url)?.cutout_image_url ??
    product.thumbnail_url;

  const srcBytes = Buffer.from(await (await fetch(srcUrl)).arrayBuffer());
  if (!(await isWhiteBg(srcBytes))) return skip("not a white-bg product shot");

  await setStatus("pending");
  try {
    const mountNote = promptResult.note;
    // Fetch the reference photos for the selected props AND the faucet fixture.
    // A failed fetch just drops that one reference — never fatal.
    const fetched = await Promise.all(
      allRefIds.map(async (id) => {
        const url = refUrlById.get(id);
        if (!url) return null;
        try {
          return Buffer.from(await (await fetch(url)).arrayBuffer());
        } catch {
          return null;
        }
      }),
    );
    const referenceImages = fetched.filter((b) => b != null) as Buffer[];
    const cover = await buildSceneCoverPng(
      srcBytes,
      finalPrompt,
      referenceImages,
    );

    // Coverage QC (PB #33) — measure how much of the frame the product fills.
    // A detection failure is NON-fatal: coverage stays null ("未检测"), the
    // image is kept, generation is never blocked by its own quality check.
    let coveragePct: number | null = null;
    try {
      coveragePct = await measureSceneCoverage(cover);
    } catch (e) {
      console.warn(
        `scene coverage未检测: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    const path = `${productId}/scene-${Date.now()}.png`;
    const { error: upErr } = await supabase.storage
      .from("cutouts")
      .upload(path, new Blob([cover as BlobPart], { type: "image/png" }), {
        upsert: true,
        contentType: "image/png",
        cacheControl: "31536000",
      });
    if (upErr) throw new Error(`upload: ${upErr.message}`);
    const url = `${supabase.storage.from("cutouts").getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;

    const { error: tErr } = await supabase
      .from("products")
      .update({ thumbnail_url: url })
      .eq("id", productId);
    if (tErr) throw new Error(`thumbnail update: ${tErr.message}`);

    // Persist attributes: the coverage-QC number (PB #33) + which in-catalog
    // accessories this scene referenced (the data basis for a future "other
    // products in this scene" link — this round only stored). Both live in
    // attributes JSON so no migration is needed. One update; tolerant — a record
    // failure must never fail an otherwise-good generation. coveragePct is
    // ALWAYS written (a number, or null to clear a stale value from a prior
    // regenerate → back to "未检测").
    const nextAttributes: Record<string, unknown> = {
      ...(product.attributes ?? {}),
      scene_coverage_pct: coveragePct,
    };
    if (allRefIds.length > 0) {
      nextAttributes.scene_reference_product_ids = allRefIds;
    }
    const { error: aErr } = await supabase
      .from("products")
      .update({ attributes: nextAttributes })
      .eq("id", productId);
    if (aErr) console.warn(`scene attributes record failed: ${aErr.message}`);

    await supabase.from("product_images").insert({
      product_id: productId,
      state: "cutout_approved",
      cutout_image_url: url,
      image_kind: "real_photo",
      skip_cutout: true,
      feed_to_ai: false,
      show_on_storefront: true,
      is_primary_thumbnail: false,
    });

    await setStatus("done");
    return { status: "done", url, note: mountNote };
  } catch (e) {
    // Make the failure visible + keep it from being swallowed upstream.
    const msg = e instanceof Error ? e.message : String(e);
    await setStatus("failed", msg.slice(0, 1000));
    throw e;
  }
}
