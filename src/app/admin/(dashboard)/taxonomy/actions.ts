"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { invalidateTaxonomyCache } from "@/lib/taxonomy";
import { getOpenAI, OPENAI_MODEL } from "@/lib/ai/openai";
// Fallback (Anthropic) preserved in src/lib/ai/anthropic.ts — see that
// file's header for the one-commit restore procedure.

type TaxonomyKind = "item_types" | "rooms" | "styles" | "materials" | "colors";

const VALID_KINDS: TaxonomyKind[] = [
  "item_types",
  "rooms",
  "styles",
  "materials",
  "colors",
];

function slugify(input: string): string {
  // Always normalize: lowercase, ASCII-only, collapse everything else to `_`.
  // Runs on both the label fallback AND any user-typed slug — we never
  // "reject for format", we just clean it up silently.
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function kindFromForm(fd: FormData): TaxonomyKind {
  const raw = fd.get("kind")?.toString() ?? "";
  if (!(VALID_KINDS as string[]).includes(raw)) {
    throw new Error(`invalid kind: ${raw}`);
  }
  return raw as TaxonomyKind;
}

export async function addTaxonomyItem(fd: FormData): Promise<void> {
  const kind = kindFromForm(fd);
  const label = fd.get("label_en")?.toString().trim() ?? "";
  const slugRaw = fd.get("slug")?.toString().trim() ?? "";
  const hex = fd.get("hex")?.toString().trim() ?? "";

  if (!label) {
    redirect(`/admin/taxonomy?err=label&kind=${kind}`);
  }

  // Slugify whatever the user typed (or the English label if they didn't).
  // Since label_en is ASCII, the "nothing printable left after cleaning"
  // edge case is rare but we keep the guard for inputs like "..." or
  // all-emoji.
  const slug = slugify(slugRaw || label);
  if (!slug) {
    redirect(`/admin/taxonomy?err=slug&kind=${kind}`);
  }

  const supabase = createServiceRoleClient();

  // zh + ms are left null on insert — the admin clicks "Auto-translate
  // missing" on /admin/taxonomy to fill them via OpenAI GPT-4o-mini.
  if (kind === "colors") {
    if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) {
      redirect(`/admin/taxonomy?err=hex&kind=${kind}`);
    }
    const { error } = await supabase
      .from("colors")
      .insert({ slug, label_en: label, hex });
    if (error) {
      redirect(
        `/admin/taxonomy?err=db&kind=${kind}&msg=${encodeURIComponent(error.message)}`,
      );
    }
  } else {
    const { error } = await supabase
      .from(kind)
      .insert({ slug, label_en: label });
    if (error) {
      redirect(
        `/admin/taxonomy?err=db&kind=${kind}&msg=${encodeURIComponent(error.message)}`,
      );
    }
  }

  invalidateTaxonomyCache();
  revalidatePath("/admin/taxonomy");
  revalidatePath("/admin/products/new");
  revalidatePath("/");
  redirect(`/admin/taxonomy?added=${kind}`);
}

/** Count products that reference this taxonomy slug. Different kinds live
 *  in different product columns:
 *   - item_types → products.item_type (scalar, use eq)
 *   - rooms/styles/materials/colors → products.<col> (text[], use `cs` /
 *     "contains" which is Postgres `@>`)
 */
async function countProductsUsing(
  supabase: ReturnType<typeof createServiceRoleClient>,
  kind: TaxonomyKind,
  slug: string,
): Promise<number> {
  if (kind === "item_types") {
    const { count, error } = await supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("item_type", slug);
    if (error) throw error;
    return count ?? 0;
  }
  // kind === "rooms" | "styles" | "materials" | "colors"
  // products.<kind> is a text[] column named the same as the taxonomy table.
  const column = kind; // "rooms" | "styles" | "materials" | "colors"
  const { count, error } = await supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .contains(column, [slug]);
  if (error) throw error;
  return count ?? 0;
}

export async function deleteTaxonomyItem(fd: FormData): Promise<void> {
  const kind = kindFromForm(fd);
  const slug = fd.get("slug")?.toString() ?? "";
  if (!slug) return;

  const supabase = createServiceRoleClient();

  // Guardrail: refuse to delete if any product is still using this slug.
  // Otherwise we'd orphan data (e.g. product.materials still contains "brass"
  // but the `brass` row is gone → broken label lookups, broken filters).
  let inUse = 0;
  try {
    inUse = await countProductsUsing(supabase, kind, slug);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    redirect(
      `/admin/taxonomy?err=db&kind=${kind}&msg=${encodeURIComponent(msg)}`,
    );
  }
  if (inUse > 0) {
    redirect(
      `/admin/taxonomy?err=inuse&kind=${kind}&slug=${encodeURIComponent(slug)}&count=${inUse}`,
    );
  }

  const { error } = await supabase.from(kind).delete().eq("slug", slug);
  if (error) {
    redirect(
      `/admin/taxonomy?err=db&kind=${kind}&msg=${encodeURIComponent(error.message)}`,
    );
  }

  invalidateTaxonomyCache();
  revalidatePath("/admin/taxonomy");
  revalidatePath("/admin/products/new");
  revalidatePath("/");
  redirect(`/admin/taxonomy?deleted=${kind}`);
}

// ─── translate missing labels (OpenAI GPT-4o-mini) ─────────────────

type TranslateJob = {
  kind: TaxonomyKind;
  slug: string;
  label_en: string;
  need_zh: boolean;
  need_ms: boolean;
};

type TranslatedLabel = {
  slug: string;
  label_zh: string;
  label_ms: string;
};

/** How many rows to send per model call. Kept small so a malformed
 *  response only wastes one batch, and so one call fits comfortably
 *  inside GPT-4o-mini's output-token budget. ~30 is plenty for our 6
 *  taxonomy tables combined. */
const BATCH_SIZE = 30;

function isTranslatedLabelArray(v: unknown): v is TranslatedLabel[] {
  if (!Array.isArray(v)) return false;
  return v.every(
    (r) =>
      r &&
      typeof r === "object" &&
      typeof (r as TranslatedLabel).slug === "string" &&
      typeof (r as TranslatedLabel).label_zh === "string" &&
      typeof (r as TranslatedLabel).label_ms === "string",
  );
}

/** Call OpenAI once to translate a batch of rows. Returns the parsed
 *  array on success, throws on network / JSON / shape errors.
 *
 *  We use Chat Completions with `response_format: { type: "json_object" }`
 *  (JSON mode) — the model is guaranteed to return parseable JSON, and
 *  we wrap the array in `{ translations: [...] }` because JSON mode
 *  requires an object at the top level. */
async function translateBatch(
  jobs: TranslateJob[],
): Promise<TranslatedLabel[]> {
  const openai = getOpenAI();

  const systemPrompt = [
    "You translate furniture e-commerce taxonomy labels from English into",
    "Simplified Chinese and Bahasa Melayu for a Malaysian audience (decoright.my).",
    "",
    "RULES:",
    '- Respond with a JSON object of shape { "translations": [ ... ] }.',
    '- Each translations element: { "slug": string, "label_zh": string, "label_ms": string }',
    "- Preserve every input slug exactly — same count, same order.",
    "- Simplified Chinese: short common retail term",
    '  (e.g. "Coffee Table" → 茶几; "TV Cabinet" → 电视柜; "Living Room" → 客厅).',
    "- Bahasa Melayu: standard Malaysian Malay as used by furniture retailers",
    '  (e.g. "Coffee Table" → "Meja Kopi"; "Living Room" → "Ruang Tamu"; "Modern" → "Moden").',
    "- Keep labels short (1–3 words typical). No trailing punctuation.",
    "- For colors: plain color name in each language",
    '  (e.g. "Off-white" → 米白 / "Putih Krim"; "Natural Wood" → 原木色 / "Kayu Asli").',
  ].join("\n");

  const userPayload = jobs.map((j) => ({
    slug: j.slug,
    label_en: j.label_en,
    kind: j.kind,
  }));

  const resp = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    // JSON mode: model guaranteed to return syntactically valid JSON.
    // Shape validation still happens below — the guarantee is only
    // "parseable", not "matches our schema".
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Translate these ${jobs.length} labels and return them under "translations":\n${JSON.stringify(userPayload, null, 2)}`,
      },
    ],
  });

  const text = resp.choices[0]?.message?.content?.trim() ?? "";
  if (!text) {
    throw new Error("OpenAI returned an empty response");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // JSON mode should make this unreachable, but cheap to guard.
    throw new Error(`OpenAI returned non-JSON: ${text.slice(0, 200)}`);
  }

  const inner =
    parsed && typeof parsed === "object" && "translations" in parsed
      ? (parsed as { translations: unknown }).translations
      : parsed;

  if (!isTranslatedLabelArray(inner)) {
    throw new Error(`OpenAI returned wrong shape: ${text.slice(0, 200)}`);
  }
  return inner;
}

/**
 * Find every taxonomy row with label_zh OR label_ms null, ask the
 * model (OpenAI GPT-4o-mini) to translate from the canonical label_en
 * in batches, write the results back. Returns via redirect query
 * params so the admin page can show a toast.
 *
 * Only fills columns that are NULL — never overwrites an existing
 * translation. Admins can clear a cell in the SQL editor and re-run
 * if they want to re-translate.
 */
export async function translateMissingTaxonomy(): Promise<void> {
  const supabase = createServiceRoleClient();

  // Pull every row from every taxonomy table where at least one
  // translation column is null. We do 5 parallel queries — there are
  // only ~5-50 rows per table so this is cheap.
  const [it, rm, st, mt, co] = await Promise.all([
    supabase
      .from("item_types")
      .select("slug, label_en, label_zh, label_ms")
      .or("label_zh.is.null,label_ms.is.null"),
    supabase
      .from("rooms")
      .select("slug, label_en, label_zh, label_ms")
      .or("label_zh.is.null,label_ms.is.null"),
    supabase
      .from("styles")
      .select("slug, label_en, label_zh, label_ms")
      .or("label_zh.is.null,label_ms.is.null"),
    supabase
      .from("materials")
      .select("slug, label_en, label_zh, label_ms")
      .or("label_zh.is.null,label_ms.is.null"),
    supabase
      .from("colors")
      .select("slug, label_en, label_zh, label_ms")
      .or("label_zh.is.null,label_ms.is.null"),
  ]);

  for (const r of [it, rm, st, mt, co]) {
    if (r.error) {
      redirect(
        `/admin/taxonomy?err=db&kind=translate&msg=${encodeURIComponent(r.error.message)}`,
      );
    }
  }

  const jobs: TranslateJob[] = [
    ...(it.data ?? []).map(
      (r): TranslateJob => ({
        kind: "item_types",
        slug: r.slug,
        label_en: r.label_en,
        need_zh: r.label_zh == null,
        need_ms: r.label_ms == null,
      }),
    ),
    ...(rm.data ?? []).map(
      (r): TranslateJob => ({
        kind: "rooms",
        slug: r.slug,
        label_en: r.label_en,
        need_zh: r.label_zh == null,
        need_ms: r.label_ms == null,
      }),
    ),
    ...(st.data ?? []).map(
      (r): TranslateJob => ({
        kind: "styles",
        slug: r.slug,
        label_en: r.label_en,
        need_zh: r.label_zh == null,
        need_ms: r.label_ms == null,
      }),
    ),
    ...(mt.data ?? []).map(
      (r): TranslateJob => ({
        kind: "materials",
        slug: r.slug,
        label_en: r.label_en,
        need_zh: r.label_zh == null,
        need_ms: r.label_ms == null,
      }),
    ),
    ...(co.data ?? []).map(
      (r): TranslateJob => ({
        kind: "colors",
        slug: r.slug,
        label_en: r.label_en,
        need_zh: r.label_zh == null,
        need_ms: r.label_ms == null,
      }),
    ),
  ];

  if (jobs.length === 0) {
    redirect(`/admin/taxonomy?translated=0`);
  }

  // Group by kind to batch — not required, but keeps similar terms
  // together which tends to produce more consistent translations
  // (e.g. all colors in one call yields matching register).
  const batches: TranslateJob[][] = [];
  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    batches.push(jobs.slice(i, i + BATCH_SIZE));
  }

  let totalWritten = 0;
  try {
    for (const batch of batches) {
      const translated = await translateBatch(batch);
      const bySlug = new Map(translated.map((t) => [t.slug, t]));

      // Group the update payloads by (kind, slug) so we hit each table
      // with one UPDATE per row. Only write the columns that were null —
      // never clobber an existing translation.
      for (const job of batch) {
        const t = bySlug.get(job.slug);
        if (!t) continue; // Model dropped a row, skip silently — the
        // next run will pick it up because it's still null.

        const patch: { label_zh?: string; label_ms?: string } = {};
        if (job.need_zh) patch.label_zh = t.label_zh;
        if (job.need_ms) patch.label_ms = t.label_ms;
        if (Object.keys(patch).length === 0) continue;

        const { error } = await supabase
          .from(job.kind)
          .update(patch)
          .eq("slug", job.slug);
        if (error) {
          throw new Error(`DB update failed for ${job.kind}/${job.slug}: ${error.message}`);
        }
        totalWritten += 1;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    redirect(
      `/admin/taxonomy?err=db&kind=translate&msg=${encodeURIComponent(msg)}`,
    );
  }

  invalidateTaxonomyCache();
  revalidatePath("/admin/taxonomy");
  revalidatePath("/");
  redirect(`/admin/taxonomy?translated=${totalWritten}`);
}
