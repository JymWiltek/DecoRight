import "server-only";

import OpenAI from "openai";
import { createServiceRoleClient } from "@/lib/supabase/service";
import type { ProductInsert } from "@/lib/supabase/types";

/**
 * Vision-backed product classification via OpenAI GPT-4o.
 *
 * Given a product's images (public cutout or signed raw URL), ask
 * the model to pick item_type / subtype / rooms / styles / colors
 * / materials from the taxonomy enums currently in the DB.
 *
 * Why structured outputs (`response_format: { type: "json_schema",
 * strict: true }`):
 *   - Enforces object shape — no runtime "expected object, got
 *     markdown" surprises.
 *   - Lets us constrain each slug to the exact enum drawn from the
 *     live taxonomy table, so the AI can't invent a slug the
 *     product-save validator would reject.
 *   - Pinned to `gpt-4o-2024-11-20` (first model that fully supports
 *     strict mode for our schema shape). A floating `gpt-4o` alias
 *     could silently regress.
 *
 * Cost / latency (dev-box estimate, ~1 cutout + 1 raw):
 *   - ~$0.005-0.010 per call (vision tokens dominate)
 *   - 3-8 s latency
 * Jym wants exact measurements on the Vercel preview run — both
 * numbers come back in `debug.usage` + `debug.latency_ms`.
 */

const MODEL = "gpt-4o-2024-11-20";
const MAX_IMAGES = 3;

export type InferInput = {
  /** Fully-qualified URLs the OpenAI endpoint can GET. Caller
   *  resolves signed URLs for private buckets before invoking. */
  imageUrls: string[];
  /** Optional: textual hints from form fields. We don't use these
   *  in Phase 3.0 (image is the stronger signal for classification)
   *  but leave them in the input shape so we can ensemble later. */
  name?: string;
  brand?: string | null;
  description?: string;
};

export type InferDebug = {
  model: string;
  latency_ms: number;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

export type InferResult = {
  /** Field subset shaped like ProductInsert for direct merge into
   *  the form state — only keys the AI actually picked get set. */
  fields: Partial<ProductInsert>;
  /** Which keys the AI inferred (for the ai_filled_fields column). */
  inferredKeys: string[];
  /** Per-field confidence in [0,1] so the UI can color-code. */
  confidence: Partial<Record<
    | "item_type"
    | "subtype_slug"
    | "room_slugs"
    | "styles"
    | "colors"
    | "materials"
    | "name"
    | "description",
    number
  >>;
  model: string;
  note?: string;
  debug: InferDebug;
};

type TaxonomyRow = {
  slug: string;
  label_en: string | null;
  label_zh: string | null;
  label_ms: string | null;
};
type SubtypeRow = TaxonomyRow & { item_type_slug: string };

/**
 * Main entry. Mints an OpenAI client per-call because server
 * actions run on fresh isolates in Vercel — no benefit from a
 * long-lived singleton, and creating on every call makes misuse
 * via a stale key unlikely.
 */
export async function inferProductFields(
  input: InferInput,
): Promise<InferResult> {
  const started = Date.now();

  if (!process.env.OPENAI_API_KEY) {
    return emptyResult(
      "OPENAI_API_KEY is not set — add it in Vercel env vars (Production + Preview + Development).",
      started,
    );
  }

  if (!input.imageUrls || input.imageUrls.length === 0) {
    return emptyResult(
      "At least one product image is required for Vision autofill.",
      started,
    );
  }

  // Load the live taxonomy so the JSON schema enum matches exactly
  // what the product-save validator accepts. If we hard-coded these
  // they'd drift the moment someone adds a new slug via /admin/taxonomy.
  const taxonomy = await loadTaxonomy();

  const schema = buildSchema(taxonomy);
  const systemPrompt = buildSystemPrompt(taxonomy);

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const images = input.imageUrls.slice(0, MAX_IMAGES);

  // Chat Completions with Structured Outputs. "detail: 'low'" would
  // save tokens but hurts accuracy for small objects (faucet handles,
  // grain pattern). We pay for "high" on the first image and
  // "low" on follow-ups — the first image carries the classification
  // signal; follow-ups are for "are all photos of the same thing?"
  const userContent: OpenAI.Chat.ChatCompletionContentPart[] = [
    { type: "text", text: "Classify this product using the taxonomy provided in the system message." },
    ...images.map((url, i) => ({
      type: "image_url" as const,
      image_url: { url, detail: (i === 0 ? "high" : "low") as "high" | "low" },
    })),
  ];

  let completion: OpenAI.Chat.ChatCompletion;
  try {
    completion = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0,
      max_tokens: 800,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "product_classification",
          strict: true,
          schema,
        },
      },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return emptyResult(`OpenAI request failed: ${msg}`, started);
  }

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    return emptyResult("OpenAI returned an empty message.", started);
  }

  let parsed: RawOutput;
  try {
    parsed = JSON.parse(raw) as RawOutput;
  } catch {
    return emptyResult("OpenAI returned unparseable JSON despite strict schema.", started);
  }

  // Post-parse validation: the strict schema should prevent invalid
  // slugs, but belt-and-braces because (a) future taxonomy edits
  // could create a window where the model sees a stale slug, and
  // (b) a user-modified /admin/taxonomy row shouldn't leak bad data
  // into products.
  const validated = applyTaxonomyGuards(parsed, taxonomy);

  const fields: Partial<ProductInsert> = {};
  const inferredKeys: string[] = [];

  // Free-text fields first — name/description carry their own
  // confidence and are independent of the taxonomy enums.
  if (validated.name) {
    fields.name = validated.name;
    inferredKeys.push("name");
  }
  if (validated.description) {
    fields.description = validated.description;
    inferredKeys.push("description");
  }
  if (validated.item_type) {
    fields.item_type = validated.item_type;
    inferredKeys.push("item_type");
  }
  if (validated.subtype_slug) {
    fields.subtype_slug = validated.subtype_slug;
    inferredKeys.push("subtype_slug");
  }
  if (validated.room_slugs.length > 0) {
    fields.room_slugs = validated.room_slugs;
    inferredKeys.push("room_slugs");
  }
  if (validated.styles.length > 0) {
    fields.styles = validated.styles;
    inferredKeys.push("styles");
  }
  if (validated.colors.length > 0) {
    fields.colors = validated.colors;
    inferredKeys.push("colors");
  }
  if (validated.materials.length > 0) {
    fields.materials = validated.materials;
    inferredKeys.push("materials");
  }

  return {
    fields,
    inferredKeys,
    confidence: validated.confidence,
    model: MODEL,
    note: inferredKeys.length === 0
      ? "The model returned no confident classifications for this image."
      : undefined,
    debug: {
      model: MODEL,
      latency_ms: Date.now() - started,
      usage: {
        prompt_tokens: completion.usage?.prompt_tokens,
        completion_tokens: completion.usage?.completion_tokens,
        total_tokens: completion.usage?.total_tokens,
      },
    },
  };
}

// ─── helpers ──────────────────────────────────────────────────

type Taxonomy = {
  itemTypes: TaxonomyRow[];
  subtypes: SubtypeRow[];
  rooms: TaxonomyRow[];
  styles: TaxonomyRow[];
  colors: TaxonomyRow[];
  materials: TaxonomyRow[];
};

async function loadTaxonomy(): Promise<Taxonomy> {
  const supabase = createServiceRoleClient();
  const [itemTypes, subtypes, rooms, styles, colors, materials] = await Promise.all([
    supabase.from("item_types").select("slug, label_en, label_zh, label_ms"),
    supabase.from("item_subtypes").select("slug, item_type_slug, label_en, label_zh, label_ms"),
    supabase.from("rooms").select("slug, label_en, label_zh, label_ms"),
    supabase.from("styles").select("slug, label_en, label_zh, label_ms"),
    supabase.from("colors").select("slug, label_en, label_zh, label_ms"),
    supabase.from("materials").select("slug, label_en, label_zh, label_ms"),
  ]);
  return {
    itemTypes: (itemTypes.data ?? []) as TaxonomyRow[],
    subtypes: (subtypes.data ?? []) as SubtypeRow[],
    rooms: (rooms.data ?? []) as TaxonomyRow[],
    styles: (styles.data ?? []) as TaxonomyRow[],
    colors: (colors.data ?? []) as TaxonomyRow[],
    materials: (materials.data ?? []) as TaxonomyRow[],
  };
}

/**
 * Build the strict JSON Schema. In OpenAI strict mode every
 * property must be listed in `required` and `additionalProperties`
 * is always false. Nullable fields use `type: ["string", "null"]`.
 *
 * We enum-constrain single-select slugs to live values plus null.
 * For multi-selects we constrain each item to live slugs; empty
 * arrays are the "no pick" state (the schema doesn't need null
 * for them).
 *
 * Keep subtype unconstrained at schema level — it depends on the
 * chosen item_type, so we validate that pair post-parse instead of
 * trying to express a dependent enum in JSON Schema.
 */
function buildSchema(t: Taxonomy): Record<string, unknown> {
  const slugs = (rows: { slug: string }[]) => rows.map((r) => r.slug);
  const itemTypeEnum = [...slugs(t.itemTypes), null];
  const roomEnum = slugs(t.rooms);
  const styleEnum = slugs(t.styles);
  const colorEnum = slugs(t.colors);
  const materialEnum = slugs(t.materials);
  const subtypeEnum = [...slugs(t.subtypes), null];

  return {
    type: "object",
    properties: {
      // Free-text fields. Strict mode requires every property be in
      // `required` and `additionalProperties:false`; we allow null so
      // the model can opt out instead of inventing copy.
      name: { type: ["string", "null"] },
      description: { type: ["string", "null"] },
      item_type: { type: ["string", "null"], enum: itemTypeEnum },
      subtype_slug: { type: ["string", "null"], enum: subtypeEnum },
      room_slugs: {
        type: "array",
        items: { type: "string", enum: roomEnum },
      },
      styles: {
        type: "array",
        items: { type: "string", enum: styleEnum },
      },
      colors: {
        type: "array",
        items: { type: "string", enum: colorEnum },
      },
      materials: {
        type: "array",
        items: { type: "string", enum: materialEnum },
      },
      confidence: {
        type: "object",
        properties: {
          name: { type: "number" },
          description: { type: "number" },
          item_type: { type: "number" },
          subtype_slug: { type: "number" },
          room_slugs: { type: "number" },
          styles: { type: "number" },
          colors: { type: "number" },
          materials: { type: "number" },
        },
        required: [
          "name",
          "description",
          "item_type",
          "subtype_slug",
          "room_slugs",
          "styles",
          "colors",
          "materials",
        ],
        additionalProperties: false,
      },
    },
    required: [
      "name",
      "description",
      "item_type",
      "subtype_slug",
      "room_slugs",
      "styles",
      "colors",
      "materials",
      "confidence",
    ],
    additionalProperties: false,
  };
}

function buildSystemPrompt(t: Taxonomy): string {
  const fmt = (rows: TaxonomyRow[]) =>
    rows
      .map(
        (r) =>
          `  - ${r.slug}  (${[r.label_en, r.label_zh, r.label_ms]
            .filter(Boolean)
            .join(" / ")})`,
      )
      .join("\n");
  const fmtSub = (rows: SubtypeRow[]) =>
    rows
      .map(
        (r) =>
          `  - ${r.slug}  (belongs to item_type "${r.item_type_slug}"; ${[
            r.label_en,
            r.label_zh,
            r.label_ms,
          ]
            .filter(Boolean)
            .join(" / ")})`,
      )
      .join("\n");

  return [
    "You are a home-furnishing product classifier + copywriter for DecoRight (a Malaysia-market bathroom / home catalog).",
    "Look at the product photos and classify against the TAXONOMY below. Return slugs only — never free text — for taxonomy fields.",
    "Also write a short product NAME and DESCRIPTION (free text).",
    "",
    "NAME (string, ≤30 characters, English):",
    "  - Concise, retail-style. e.g. 'Pull-out Kitchen Faucet', 'Modern Oak Console'.",
    "  - Avoid brand names unless they're clearly visible on the product itself.",
    "  - No marketing fluff ('Stunning!', 'Must-have!'). Plain noun phrase.",
    "  - Return null only if the image is unclassifiable.",
    "",
    "DESCRIPTION (string, 1–2 sentences, English):",
    "  - Plain factual blurb. e.g. 'Pull-out spray faucet in matte black, suitable for modern kitchen sinks. Single-handle mixer with 360° swivel.'",
    "  - Mention key visible features (material, finish, shape, mounting style) without inventing dimensions or specs you can't see.",
    "  - No marketing exclamations.",
    "  - Return null only if you returned null for name.",
    "",
    "ITEM TYPES (pick exactly one, or null):",
    fmt(t.itemTypes),
    "",
    "ITEM SUBTYPES (pick one that belongs to your chosen item_type, or null if none fit):",
    fmtSub(t.subtypes),
    "",
    "ROOMS (pick zero or more — rooms where this product would reasonably be installed):",
    fmt(t.rooms),
    "",
    "STYLES (pick zero or more — visual design styles that describe this product):",
    fmt(t.styles),
    "",
    "COLORS (pick zero or more — dominant visible colors; ignore background):",
    fmt(t.colors),
    "",
    "MATERIALS (pick zero or more — visible materials; guess from surface appearance):",
    fmt(t.materials),
    "",
    "CONFIDENCE: for each of the eight fields (name, description, item_type, subtype_slug, room_slugs, styles, colors, materials) return a number in [0,1]:",
    "  - 0.9+ : unambiguous (clear single object in focus, obvious material)",
    "  - 0.5-0.9: reasonably confident",
    "  - below 0.5: low-confidence guess, reviewer should double-check",
    "  - 0.0 : you did not produce anything (null / empty array / empty string)",
    "",
    "RULES:",
    "- Never invent a slug. Only use slugs listed above.",
    "- subtype_slug must belong to the chosen item_type. If none fits, return null.",
    "- If you cannot identify the object at all (blurry / blank / non-product image), return null for name, description, item_type, subtype_slug, and empty arrays for the rest, with confidence 0 across the board.",
    "- Prefer fewer, higher-confidence picks over many low-confidence ones. For multi-selects, only pick values you'd score ≥ 0.5.",
  ].join("\n");
}

type RawOutput = {
  name: string | null;
  description: string | null;
  item_type: string | null;
  subtype_slug: string | null;
  room_slugs: string[];
  styles: string[];
  colors: string[];
  materials: string[];
  confidence: {
    name: number;
    description: number;
    item_type: number;
    subtype_slug: number;
    room_slugs: number;
    styles: number;
    colors: number;
    materials: number;
  };
};

type Validated = {
  name: string | null;
  description: string | null;
  item_type: string | null;
  subtype_slug: string | null;
  room_slugs: string[];
  styles: string[];
  colors: string[];
  materials: string[];
  confidence: InferResult["confidence"];
};

function applyTaxonomyGuards(raw: RawOutput, t: Taxonomy): Validated {
  const inSet = (rows: { slug: string }[]) => new Set(rows.map((r) => r.slug));
  const itemTypeSet = inSet(t.itemTypes);
  const roomSet = inSet(t.rooms);
  const styleSet = inSet(t.styles);
  const colorSet = inSet(t.colors);
  const materialSet = inSet(t.materials);

  const item_type = raw.item_type && itemTypeSet.has(raw.item_type) ? raw.item_type : null;

  // Subtype is only valid if (a) it exists, (b) its item_type_slug
  // matches the chosen item_type. If item_type is null, subtype must
  // also be null.
  let subtype_slug: string | null = null;
  if (raw.subtype_slug && item_type) {
    const sub = t.subtypes.find((s) => s.slug === raw.subtype_slug);
    if (sub && sub.item_type_slug === item_type) {
      subtype_slug = sub.slug;
    }
  }

  const keep = (input: string[], set: Set<string>) =>
    [...new Set(input.filter((s) => set.has(s)))];

  // Free-text fields: trim + treat empty string as null. Cap name at
  // 30 chars (the prompt says ≤30 but the model occasionally cheats —
  // truncate rather than reject the whole run). Description gets a
  // generous 500-char cap to keep a runaway response from blowing
  // the products.description column.
  const trimName = typeof raw.name === "string" ? raw.name.trim() : "";
  const trimDesc =
    typeof raw.description === "string" ? raw.description.trim() : "";
  const name = trimName.length > 0 ? trimName.slice(0, 30) : null;
  const description = trimDesc.length > 0 ? trimDesc.slice(0, 500) : null;

  return {
    name,
    description,
    item_type,
    subtype_slug,
    room_slugs: keep(raw.room_slugs, roomSet),
    styles: keep(raw.styles, styleSet),
    colors: keep(raw.colors, colorSet),
    materials: keep(raw.materials, materialSet),
    confidence: {
      name: clamp01(raw.confidence.name),
      description: clamp01(raw.confidence.description),
      item_type: clamp01(raw.confidence.item_type),
      subtype_slug: clamp01(raw.confidence.subtype_slug),
      room_slugs: clamp01(raw.confidence.room_slugs),
      styles: clamp01(raw.confidence.styles),
      colors: clamp01(raw.confidence.colors),
      materials: clamp01(raw.confidence.materials),
    },
  };
}

function clamp01(n: number): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function emptyResult(note: string, started: number): InferResult {
  return {
    fields: {},
    inferredKeys: [],
    confidence: {},
    model: MODEL,
    note,
    debug: { model: MODEL, latency_ms: Date.now() - started },
  };
}
