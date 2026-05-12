/**
 * Wave 3 — GPT-4o vision parser for brand spec sheets.
 *
 * NOT marked `server-only`: getOpenAI() (lib/ai/openai.ts) is, and
 * since this module's only side-effect is calling that, the build-
 * time client-import guard there is enough. The omission lets us
 * unit-test parseSpecSheet() via tsx-run scripts without hitting the
 * server-only-throws-on-CJS-import behavior.
 *
 *
 * Input: a brand-published product spec image (PDF screenshot,
 * manufacturer product-page screen, datasheet snip). The operator
 * uploads it; we send it to OpenAI's vision endpoint with a JSON-
 * schema response_format pinning the output shape.
 *
 * Output: a structured `SpecSheetParse` with nullable fields for
 * each piece of data we want the operator to confirm before
 * persisting.
 *
 * Why a separate path from the existing photo-classifier (lib/ai/
 * infer.ts): different inputs (a brand datasheet is text-heavy and
 * label-driven, not a hero photo) and different output fields
 * (name/brand/sku/dimensions/weight/description vs. item_type/style/
 * color/material/room). Mixing the two in one prompt confused
 * gpt-4o-mini on early experiments; gpt-4o (the full model) is the
 * tier where vision-text reasoning is reliable enough for OCR-style
 * extraction.
 *
 * Cost: ~$0.005-$0.02 per spec sheet (gpt-4o vision input is priced
 * per 1k tokens of decoded image + the text). The api_usage cap is
 * read by the route caller, not here, so this module is purely
 * compute.
 */

import { getOpenAI } from "./openai";

/** Closed schema for what the AI may produce. Every field is nullable
 *  because spec sheets rarely have ALL fields — a brand datasheet
 *  often skips weight, a product-page screen often skips depth, etc. */
export type SpecSheetParse = {
  /** Full product name as printed on the sheet — usually the H1
   *  or the product line at the top. Null if unclear. */
  name: string | null;
  /** Brand / manufacturer name. Null if not visible. */
  brand: string | null;
  /** SKU / model code. Examples: "WD012", "A400-PS", "DCS-ECWC". */
  sku_id: string | null;
  /**
   * 1-3 sentence factual description suitable for the storefront.
   * NOT marketing copy — we want measurable facts (trap type, mounting
   * style, included accessories, water-saving tier, etc.).
   */
  description: string | null;
  /** Dimensions in millimeters. Spec sheets sometimes use inches —
   *  the model converts before returning. Null if not all three
   *  axes are present. */
  dimensions_mm: {
    length: number | null;
    width: number | null;
    height: number | null;
  } | null;
  /** Weight in kilograms. Sometimes spec sheets give pounds — the
   *  model converts. Null if missing. */
  weight_kg: number | null;
  /** Free-form note for the operator. Used for low-confidence
   *  extractions, ambiguous units, or "this looks like a product
   *  photo, not a spec sheet". Empty string = no note. */
  notes: string;
};

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "name",
    "brand",
    "sku_id",
    "description",
    "dimensions_mm",
    "weight_kg",
    "notes",
  ],
  properties: {
    name: { type: ["string", "null"] },
    brand: { type: ["string", "null"] },
    sku_id: { type: ["string", "null"] },
    description: { type: ["string", "null"] },
    dimensions_mm: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["length", "width", "height"],
      properties: {
        length: { type: ["number", "null"] },
        width: { type: ["number", "null"] },
        height: { type: ["number", "null"] },
      },
    },
    weight_kg: { type: ["number", "null"] },
    notes: { type: "string" },
  },
} as const;

const SYSTEM_PROMPT = `You extract product spec data from brand spec sheets, datasheets, and manufacturer product page screenshots for a furniture / sanitary-ware retailer.

Output ONLY a JSON object matching the provided schema.

Rules:
- name: full product name as printed (e.g. "One Piece Washdown Water Closet", "Marble Round Counter Top Basin"). Null if unclear.
- brand: manufacturer / brand name (e.g. "Roca", "TOTO", "Docasa"). Null if not visible.
- sku_id: model code / SKU verbatim from the sheet (e.g. "A400-PS", "WD012", "DCS-ECWC"). Preserve original spacing and dashes.
- description: 1–3 plain sentences of factual specs. Examples:
    "S-Trap 100–300mm or P-Trap 180mm. Dual-flush 3/6L. Soft-close PP/UF seat optional."
    "Single bowl, deck-mounted. Ceramic. Includes pop-up waste."
  Avoid marketing language ("luxurious", "elegant"). Prefer numbers and named features.
- dimensions_mm: ALWAYS millimeters. If the sheet uses inches/cm/etc., convert. Order: length × width × height (sometimes called depth × width × height in datasheets — pick the values consistent with the orthographic views shown). Null any axis you can't read confidently. If fewer than 3 axes are legible return null for the whole object.
- weight_kg: kilograms. Convert from lb if needed.
- notes: empty string by default. Use it for:
    • "Image looks like a product photo, not a spec sheet" if you couldn't find any spec data.
    • A 1-line caveat if you had to guess at a value.
    • Otherwise leave as "".

If the image clearly is NOT a spec sheet (e.g. a hero photo, a colour swatch chip), return all fields null and put "Image does not appear to be a spec sheet — no values extracted." in notes.`;

/**
 * Drive the model. Throws on transport / decode failure; the caller
 * is expected to surface a friendly error to the operator and not
 * persist anything. Successful return = parsed JSON conforming to
 * the schema; the caller still validates types via runtime guards
 * before applying to the form.
 */
export async function parseSpecSheet(
  imageBytes: Uint8Array,
  mimeType: string,
): Promise<{ result: SpecSheetParse; usage: { promptTokens: number; completionTokens: number; estCostUsd: number } }> {
  const openai = getOpenAI();
  // Encode as data URI. OpenAI accepts up to ~20 MB images; spec
  // sheets are usually < 2 MB so we don't bother streaming.
  const b64 = Buffer.from(imageBytes).toString("base64");
  const dataUrl = `data:${mimeType};base64,${b64}`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0, // deterministic extraction
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Extract the product spec data from this image:",
          },
          { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "spec_sheet_parse",
        strict: true,
        schema: RESPONSE_SCHEMA,
      },
    },
  });

  const text = completion.choices[0]?.message?.content ?? "{}";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(
      `parseSpecSheet: GPT returned non-JSON: ${text.slice(0, 200)} (${e instanceof Error ? e.message : String(e)})`,
    );
  }
  const result = parsed as SpecSheetParse;

  // Cost estimate (rough) — gpt-4o vision input ~$2.50 / 1M tokens,
  // output ~$10 / 1M. The image counts as input tokens via OpenAI's
  // own tiling math; we just use the API-reported counts.
  const promptTokens = completion.usage?.prompt_tokens ?? 0;
  const completionTokens = completion.usage?.completion_tokens ?? 0;
  const estCostUsd =
    (promptTokens / 1_000_000) * 2.5 + (completionTokens / 1_000_000) * 10;

  return {
    result,
    usage: { promptTokens, completionTokens, estCostUsd },
  };
}

/** Wave 6 — bound on how many images go into one merged GPT-4o call.
 *  Per Jym's spec. Each image consumes ~700-1500 prompt tokens at
 *  high detail; 5 images puts us in the 4-8k token range, comfortably
 *  inside gpt-4o's 128k window without ballooning per-call cost. */
export const MERGED_PARSE_MAX_IMAGES = 5;

/** Wave 6 — merged multi-image parse result. Same SpecSheetParse
 *  shape (every field nullable). The notes field becomes especially
 *  useful here: it can flag conflicts between images ("image 2 says
 *  680mm but image 4 says 685mm"). */
export type MergedParseInput = {
  /** Public/signed URL OR base64 data URL. The OpenAI client accepts
   *  either. We prefer real URLs to avoid the b64 round-trip in our
   *  process; the route-side caller can opt for data: URLs when the
   *  bytes are easier to fetch server-side. */
  url: string;
  /** Optional MIME type — only used when constructing data URLs.
   *  Real http(s) URLs ignore this. */
  mimeType?: string;
};

const MERGED_SYSTEM_PROMPT = `${SYSTEM_PROMPT}

This time you are looking at MULTIPLE images of the SAME product (a brand spec sheet, a manufacturer product page screenshot, photos of the actual installed product, even close-ups of dimension diagrams). Merge the information across all images:
- If image A shows a dimension and image B shows the same dimension, prefer the more legible one and use its value.
- If two images conflict on a value, pick the one most likely to be a brand spec (datasheet > photo) and note the conflict in notes.
- If the SKU appears on multiple images, use the verbatim string.
- For descriptions, weave together the factual specs you can see across images.
- A photo of the installed product without text on it adds zero information — don't penalize it; just don't try to read fields off it.
`;

/**
 * Wave 6 — multi-image merged parse. Sends multiple images to GPT-4o
 * as a single user message and asks for one merged result.
 *
 * Use this when the operator has photographed a brand spec sheet from
 * multiple angles, OR has separate diagrams for dimensions vs.
 * description vs. SKU label. ONE api_usage row is logged for the
 * whole call (the caller writes it; this module is pure compute).
 *
 * Throws on transport / decode failure. Caller surfaces a friendly
 * error and does NOT persist anything on throw.
 */
export async function parseImagesMerged(
  inputs: MergedParseInput[],
): Promise<{
  result: SpecSheetParse;
  usage: { promptTokens: number; completionTokens: number; estCostUsd: number };
  imageCount: number;
}> {
  if (inputs.length === 0) {
    throw new Error("parseImagesMerged: at least 1 image required");
  }
  if (inputs.length > MERGED_PARSE_MAX_IMAGES) {
    throw new Error(
      `parseImagesMerged: at most ${MERGED_PARSE_MAX_IMAGES} images per call (got ${inputs.length})`,
    );
  }
  const openai = getOpenAI();
  const userContent: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail: "high" | "low" } }
  > = [
    {
      type: "text",
      text: `Extract product spec data from these ${inputs.length} image${inputs.length === 1 ? "" : "s"} of one product:`,
    },
  ];
  for (const inp of inputs) {
    userContent.push({
      type: "image_url",
      image_url: { url: inp.url, detail: "high" },
    });
  }

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0,
    messages: [
      { role: "system", content: MERGED_SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "spec_sheet_parse",
        strict: true,
        schema: RESPONSE_SCHEMA,
      },
    },
  });

  const text = completion.choices[0]?.message?.content ?? "{}";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(
      `parseImagesMerged: GPT returned non-JSON: ${text.slice(0, 200)} (${e instanceof Error ? e.message : String(e)})`,
    );
  }
  const result = parsed as SpecSheetParse;
  const promptTokens = completion.usage?.prompt_tokens ?? 0;
  const completionTokens = completion.usage?.completion_tokens ?? 0;
  const estCostUsd =
    (promptTokens / 1_000_000) * 2.5 + (completionTokens / 1_000_000) * 10;
  return {
    result,
    usage: { promptTokens, completionTokens, estCostUsd },
    imageCount: inputs.length,
  };
}

// ────────────────────────────────────────────────────────────
// Wave 7 · Commit 1 — V2 parser (per-field confidence + taxonomy)
// ────────────────────────────────────────────────────────────
//
// Why V2: bulk-create uploads 10 products at once. Operator can't
// realistically vet each one — the AI fill needs to confidently pick
// item_type, rooms, styles, materials, colors from the live taxonomy
// AND tell us how sure it is per field. The downstream
// confidence-gated auto-publish (commit 2) reads `confidence` to
// decide auto-publish vs hold-for-review.
//
// V1 is preserved unchanged for any caller that still wants the old
// shape; the single-product Autofill block and bulkCreateProducts
// both move to V2 in this commit and Commit 2 respectively.

export type Confidence = "high" | "medium" | "low";

export type FieldV2<T> = {
  /** AI-extracted value. null = AI couldn't see/guess this field. */
  value: T | null;
  /** How sure the model is:
   *   - high   : printed verbatim on the image / very strong visual cue
   *   - medium : reasonable inference from product appearance
   *   - low    : guess; operator should verify */
  confidence: Confidence;
};

export type SpecSheetParseV2 = {
  fields: {
    name: FieldV2<string>;
    brand: FieldV2<string>;
    sku_id: FieldV2<string>;
    description: FieldV2<string>;
    dimensions_mm: FieldV2<{
      length: number | null;
      width: number | null;
      height: number | null;
    }>;
    weight_kg: FieldV2<number>;
    /** Taxonomy slug from the provided allowed list. Null = no
     *  match. NEVER a made-up slug. */
    item_type_slug: FieldV2<string>;
    subtype_slug: FieldV2<string>;
    /** Plural taxonomy fields: AI picks 0+ from the provided allowed
     *  set. Empty array (not null) = none applicable.
     *  FieldV2<string[]> with value=[] is "AI looked and decided
     *  nothing applies"; value=null is "AI couldn't tell". */
    room_slugs: FieldV2<string[]>;
    style_slugs: FieldV2<string[]>;
    material_slugs: FieldV2<string[]>;
    color_slugs: FieldV2<string[]>;
  };
  notes: string;
};

/** Allowed taxonomy slug lists, passed to GPT-4o so it picks from
 *  what the DB has rather than inventing slugs. Each slug is a stable
 *  identifier; labels are not sent — the model maps from image
 *  evidence to slugs via a static prompt-side dictionary we build at
 *  call time. */
export type TaxonomyHints = {
  itemTypes: { slug: string; label_en: string }[];
  /** Subtypes grouped by item_type_slug — `subtype.item_type_slug` is
   *  encoded into the prompt so the model knows e.g. `two_piece_toilet`
   *  is only valid when item_type=`toilet`. */
  itemSubtypes: { slug: string; label_en: string; item_type_slug: string }[];
  rooms: { slug: string; label_en: string }[];
  styles: { slug: string; label_en: string }[];
  materials: { slug: string; label_en: string }[];
  colors: { slug: string; label_en: string }[];
};

function fieldSchema(valueSchema: Record<string, unknown>) {
  // Each field row is { value: T|null, confidence: enum }. The
  // strict-mode schema requires `additionalProperties:false` + all
  // properties listed in `required`.
  return {
    type: "object",
    additionalProperties: false,
    required: ["value", "confidence"],
    properties: {
      value: valueSchema,
      confidence: { type: "string", enum: ["high", "medium", "low"] },
    },
  };
}

const RESPONSE_SCHEMA_V2 = {
  type: "object",
  additionalProperties: false,
  required: ["fields", "notes"],
  properties: {
    fields: {
      type: "object",
      additionalProperties: false,
      required: [
        "name",
        "brand",
        "sku_id",
        "description",
        "dimensions_mm",
        "weight_kg",
        "item_type_slug",
        "subtype_slug",
        "room_slugs",
        "style_slugs",
        "material_slugs",
        "color_slugs",
      ],
      properties: {
        name: fieldSchema({ type: ["string", "null"] }),
        brand: fieldSchema({ type: ["string", "null"] }),
        sku_id: fieldSchema({ type: ["string", "null"] }),
        description: fieldSchema({ type: ["string", "null"] }),
        dimensions_mm: fieldSchema({
          type: ["object", "null"],
          additionalProperties: false,
          required: ["length", "width", "height"],
          properties: {
            length: { type: ["number", "null"] },
            width: { type: ["number", "null"] },
            height: { type: ["number", "null"] },
          },
        }),
        weight_kg: fieldSchema({ type: ["number", "null"] }),
        item_type_slug: fieldSchema({ type: ["string", "null"] }),
        subtype_slug: fieldSchema({ type: ["string", "null"] }),
        room_slugs: fieldSchema({
          type: ["array", "null"],
          items: { type: "string" },
        }),
        style_slugs: fieldSchema({
          type: ["array", "null"],
          items: { type: "string" },
        }),
        material_slugs: fieldSchema({
          type: ["array", "null"],
          items: { type: "string" },
        }),
        color_slugs: fieldSchema({
          type: ["array", "null"],
          items: { type: "string" },
        }),
      },
    },
    notes: { type: "string" },
  },
} as const;

function renderTaxonomyDictionary(t: TaxonomyHints): string {
  // Compact "<slug>: <label>" lines so token bloat is minimal. Skip
  // labels for colors (they're hex-driven anyway and the slug is
  // usually obvious: "white", "black", "matte_black"). Subtypes are
  // grouped under their parent item_type to encode the parent
  // constraint in the prompt itself.
  const lines: string[] = [];
  lines.push("### item_types (pick ONE, or null):");
  for (const r of t.itemTypes) lines.push(`  ${r.slug} — ${r.label_en}`);

  if (t.itemSubtypes.length) {
    lines.push("");
    lines.push(
      "### item_subtypes (pick ONE, or null; only valid when item_type matches):",
    );
    const byParent = new Map<string, typeof t.itemSubtypes>();
    for (const s of t.itemSubtypes) {
      const list = byParent.get(s.item_type_slug) ?? [];
      list.push(s);
      byParent.set(s.item_type_slug, list);
    }
    for (const [parent, subs] of byParent) {
      lines.push(`  ${parent}:`);
      for (const s of subs) lines.push(`    - ${s.slug} (${s.label_en})`);
    }
  }

  lines.push("");
  lines.push("### rooms (pick 0+ that apply, NEVER make up new slugs):");
  for (const r of t.rooms) lines.push(`  ${r.slug} — ${r.label_en}`);

  lines.push("");
  lines.push("### styles (pick 0+, only the ones with visual evidence):");
  for (const r of t.styles) lines.push(`  ${r.slug} — ${r.label_en}`);

  lines.push("");
  lines.push("### materials (pick 0+, only visible/labeled materials):");
  for (const r of t.materials) lines.push(`  ${r.slug} — ${r.label_en}`);

  lines.push("");
  lines.push("### colors (pick 0+, dominant product colors):");
  for (const r of t.colors) lines.push(`  ${r.slug} — ${r.label_en}`);

  return lines.join("\n");
}

const V2_SYSTEM_PROMPT_BASE = `You extract product spec data from MULTIPLE product images at once (these are different views / spec sheet pages / installed photos of the same single product, for a Malaysian bathroom & sanitary-ware retailer).

Be CONFIDENT. The retailer would rather have a medium-confidence "Black Freestanding Bathtub" than a null. Make educated guesses based on product appearance, then mark your confidence:
  - "high"   = printed verbatim on the image / unambiguous visual evidence
  - "medium" = inferred from product shape, color, materials with reasonable certainty
  - "low"    = guess; operator may need to review

Output ONLY a JSON object matching the provided schema.

Field-by-field rules:

- name: a 2–6 word generic product name. Generate it from what you see if not printed. Examples: "Black Freestanding Bathtub", "Round Marble Counter Top Basin", "Two-piece Washdown Toilet". NEVER null unless image is truly unparseable. mark "high" if printed verbatim, "medium" if you generated it from appearance.

- brand: identify the brand from any visible logo, tag, or label. Common brands you'll see: DOCASA, Roca, TOTO, Kohler, Wiltek, American Standard, Duravit, Hansgrohe, Ideal Standard. mark "high" if a logo or text proves it; "low" otherwise. null if no evidence at all.

- sku_id: ONLY extract if a SKU/model code is explicitly written on the image (e.g. "WC-2090", "A400-PS"). NEVER guess SKUs. confidence is always "high" if extracted; null if not visible.

- description: 1–3 plain factual sentences. Combine evidence across images. mark "high" if from a spec sheet, "medium" if inferred from photos.

- dimensions_mm: ALWAYS millimeters; convert from inches/cm/feet. Read from dimension diagrams if present. null any axis you can't confidently read. If fewer than 3 axes are legible, return null for the whole object. mark "high" if all 3 axes are printed, "medium" if you inferred 1–2.

- weight_kg: kilograms; convert from lb. null if not stated. mark "high" if printed.

- item_type_slug: pick from the allowed list. Look at product shape: a bathtub picture → toilet/basin/bathtub/etc. mark "high" if obvious; "medium" if borderline. NEVER invent a slug — use null instead.

- subtype_slug: pick from the allowed list under the chosen item_type. null if none fits. mark "high" if obvious (e.g. clearly two-piece toilet); "medium" otherwise.

- room_slugs: pick 0+ rooms where this product naturally lives. A toilet lives in bathroom — pick ["bathroom"]. A kitchen sink → ["kitchen"]. Outdoor tap → ["garden", "balcony"] if both fit. confidence applies to the whole array.

- style_slugs: pick 0+ styles with visual evidence (modern, traditional, minimalist, industrial, …). Empty array if no clear style cue.

- material_slugs: pick 0+ materials you can see / are labeled (ceramic, stainless_steel, glass, …).

- color_slugs: pick 0+ dominant colors. Don't over-pick — a 95% white toilet with a 1cm chrome trim is "white", not "white" + "silver".

- notes: empty string by default. Use only for cross-image conflicts ("image 2 says 680mm, image 4 says 685mm — used 685mm") or "image is purely decorative, no extractable spec data".

DO NOT invent slugs. DO NOT add markdown. Output JSON only.`;

/** V2 — multi-image merged parse returning per-field confidence +
 *  taxonomy slugs. Caller MUST provide TaxonomyHints loaded from the
 *  DB; the model picks slugs from those lists.
 *
 *  Cost: ~$0.01–$0.015 per call (longer prompt due to slug
 *  dictionary; same 1-call request pattern).
 */
export async function parseImagesMergedV2(
  inputs: MergedParseInput[],
  taxonomy: TaxonomyHints,
): Promise<{
  result: SpecSheetParseV2;
  usage: { promptTokens: number; completionTokens: number; estCostUsd: number };
  imageCount: number;
}> {
  if (inputs.length === 0) {
    throw new Error("parseImagesMergedV2: at least 1 image required");
  }
  if (inputs.length > MERGED_PARSE_MAX_IMAGES) {
    throw new Error(
      `parseImagesMergedV2: at most ${MERGED_PARSE_MAX_IMAGES} images per call (got ${inputs.length})`,
    );
  }
  const openai = getOpenAI();
  const systemPrompt = `${V2_SYSTEM_PROMPT_BASE}

ALLOWED TAXONOMY (use these exact slugs; never invent):

${renderTaxonomyDictionary(taxonomy)}`;

  const userContent: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail: "high" | "low" } }
  > = [
    {
      type: "text",
      text: `Extract product spec data + taxonomy from these ${inputs.length} image${inputs.length === 1 ? "" : "s"} of one product. Be confident — guess from appearance when needed and mark confidence honestly.`,
    },
  ];
  for (const inp of inputs) {
    userContent.push({
      type: "image_url",
      image_url: { url: inp.url, detail: "high" },
    });
  }

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "spec_sheet_parse_v2",
        strict: true,
        schema: RESPONSE_SCHEMA_V2,
      },
    },
  });

  const text = completion.choices[0]?.message?.content ?? "{}";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(
      `parseImagesMergedV2: GPT returned non-JSON: ${text.slice(0, 200)} (${e instanceof Error ? e.message : String(e)})`,
    );
  }
  const result = parsed as SpecSheetParseV2;
  const promptTokens = completion.usage?.prompt_tokens ?? 0;
  const completionTokens = completion.usage?.completion_tokens ?? 0;
  const estCostUsd =
    (promptTokens / 1_000_000) * 2.5 + (completionTokens / 1_000_000) * 10;
  return {
    result,
    usage: { promptTokens, completionTokens, estCostUsd },
    imageCount: inputs.length,
  };
}

/** Validate AI-returned slugs against the allowed sets and drop any
 *  hallucinated ones. Returns a copy with `value` arrays/strings
 *  filtered to only legal slugs. Confidence stays as the model
 *  reported. */
export function sanitizeV2Slugs(
  result: SpecSheetParseV2,
  taxonomy: TaxonomyHints,
): SpecSheetParseV2 {
  const itemTypeSet = new Set(taxonomy.itemTypes.map((r) => r.slug));
  const subtypesByItemType = new Map<string, Set<string>>();
  for (const s of taxonomy.itemSubtypes) {
    const set = subtypesByItemType.get(s.item_type_slug) ?? new Set<string>();
    set.add(s.slug);
    subtypesByItemType.set(s.item_type_slug, set);
  }
  const roomSet = new Set(taxonomy.rooms.map((r) => r.slug));
  const styleSet = new Set(taxonomy.styles.map((r) => r.slug));
  const materialSet = new Set(taxonomy.materials.map((r) => r.slug));
  const colorSet = new Set(taxonomy.colors.map((r) => r.slug));

  const f = result.fields;
  const itemTypeVal =
    f.item_type_slug.value && itemTypeSet.has(f.item_type_slug.value)
      ? f.item_type_slug.value
      : null;
  const subtypeVal =
    f.subtype_slug.value && itemTypeVal &&
    subtypesByItemType.get(itemTypeVal)?.has(f.subtype_slug.value)
      ? f.subtype_slug.value
      : null;

  function filterArr(
    v: string[] | null,
    set: Set<string>,
  ): string[] | null {
    if (v == null) return null;
    return v.filter((s) => set.has(s));
  }

  return {
    ...result,
    fields: {
      ...f,
      item_type_slug: { ...f.item_type_slug, value: itemTypeVal },
      subtype_slug: { ...f.subtype_slug, value: subtypeVal },
      room_slugs: {
        ...f.room_slugs,
        value: filterArr(f.room_slugs.value, roomSet),
      },
      style_slugs: {
        ...f.style_slugs,
        value: filterArr(f.style_slugs.value, styleSet),
      },
      material_slugs: {
        ...f.material_slugs,
        value: filterArr(f.material_slugs.value, materialSet),
      },
      color_slugs: {
        ...f.color_slugs,
        value: filterArr(f.color_slugs.value, colorSet),
      },
    },
  };
}
