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
