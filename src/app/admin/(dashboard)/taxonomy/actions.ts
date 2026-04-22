"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { invalidateTaxonomyCache } from "@/lib/taxonomy";
import { getAnthropic, CLAUDE_MODEL } from "@/lib/ai/anthropic";

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
  const label = fd.get("label_zh")?.toString().trim() ?? "";
  const slugRaw = fd.get("slug")?.toString().trim() ?? "";
  const hex = fd.get("hex")?.toString().trim() ?? "";

  if (!label) {
    redirect(`/admin/taxonomy?err=label&kind=${kind}`);
  }

  // Slugify whatever the user typed (or the label if they didn't type one).
  // We only bail if, AFTER cleaning, nothing printable is left — e.g. the
  // label was pure Chinese with no ASCII at all.
  const slug = slugify(slugRaw || label);
  if (!slug) {
    redirect(`/admin/taxonomy?err=slug&kind=${kind}`);
  }

  const supabase = createServiceRoleClient();

  if (kind === "colors") {
    if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) {
      redirect(`/admin/taxonomy?err=hex&kind=${kind}`);
    }
    const { error } = await supabase
      .from("colors")
      .insert({ slug, label_zh: label, hex });
    if (error) {
      redirect(
        `/admin/taxonomy?err=db&kind=${kind}&msg=${encodeURIComponent(error.message)}`,
      );
    }
  } else {
    const { error } = await supabase
      .from(kind)
      .insert({ slug, label_zh: label });
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

// ─── translate missing labels (Claude Sonnet 4.5) ──────────────────

type TranslateJob = {
  kind: TaxonomyKind;
  slug: string;
  label_zh: string;
  need_en: boolean;
  need_ms: boolean;
};

type TranslatedLabel = {
  slug: string;
  label_en: string;
  label_ms: string;
};

/** How many rows to send per Claude call. Kept small so a malformed
 *  response only wastes one batch, and so one call fits comfortably
 *  inside Claude's output-token budget. ~30 is plenty for our 6
 *  taxonomy tables combined. */
const BATCH_SIZE = 30;

function isTranslatedLabelArray(v: unknown): v is TranslatedLabel[] {
  if (!Array.isArray(v)) return false;
  return v.every(
    (r) =>
      r &&
      typeof r === "object" &&
      typeof (r as TranslatedLabel).slug === "string" &&
      typeof (r as TranslatedLabel).label_en === "string" &&
      typeof (r as TranslatedLabel).label_ms === "string",
  );
}

/** Call Claude once to translate a batch of rows. Returns the parsed
 *  array on success, throws on network / JSON / shape errors. */
async function translateBatch(
  jobs: TranslateJob[],
): Promise<TranslatedLabel[]> {
  const anthropic = getAnthropic();

  const systemPrompt = [
    "You translate furniture e-commerce taxonomy labels from Simplified Chinese",
    "into English and Bahasa Melayu for a Malaysian audience (decoright.my).",
    "",
    "RULES:",
    '- Respond with ONLY a JSON array. No prose, no markdown fences, no preamble.',
    '- Each element: { "slug": string, "label_en": string, "label_ms": string }',
    "- Preserve every input slug exactly — same count, same order.",
    "- English: Title Case, common retail terminology",
    '  (e.g. 茶几 → "Coffee Table", not "Tea Table"; 电视柜 → "TV Cabinet").',
    "- Bahasa Melayu: standard Malaysian Malay as used by furniture retailers",
    '  (e.g. 茶几 → "Meja Kopi"; 客厅 → "Ruang Tamu"; 现代 → "Moden").',
    "- Keep labels short (1–3 words typical). No trailing punctuation.",
    "- For colors: plain color name in each language",
    '  (e.g. 米白 → "Off-white" / "Putih Krim"; 原木色 → "Natural Wood" / "Kayu Asli").',
  ].join("\n");

  const userPayload = jobs.map((j) => ({
    slug: j.slug,
    label_zh: j.label_zh,
    kind: j.kind,
  }));

  const resp = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2048,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Translate these ${jobs.length} labels:\n${JSON.stringify(userPayload, null, 2)}`,
      },
    ],
  });

  // Claude's Messages API returns content as a list of blocks. For our
  // prompt Claude should emit a single text block whose content is the
  // raw JSON array — we concatenate any text blocks just in case.
  const text = resp.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();

  // Strip accidental ```json fences if the model ignores the "no
  // markdown" instruction (rare but cheap to tolerate).
  const stripped = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new Error(`Claude returned non-JSON: ${stripped.slice(0, 200)}`);
  }
  if (!isTranslatedLabelArray(parsed)) {
    throw new Error(`Claude returned wrong shape: ${stripped.slice(0, 200)}`);
  }
  return parsed;
}

/**
 * Find every taxonomy row with label_en OR label_ms null, ask Claude
 * to translate them in batches, write the results back. Returns via
 * redirect query params so the admin page can show a toast.
 *
 * Only fills columns that are NULL — never overwrites an existing
 * translation. Admins can clear a cell in the SQL editor and re-run
 * if they want to re-translate.
 */
export async function translateMissingTaxonomy(): Promise<void> {
  const supabase = createServiceRoleClient();

  // Pull every row from every taxonomy table where at least one locale
  // column is null. We do 5 parallel queries — there are only ~5-50
  // rows per table so this is cheap.
  const [it, rm, st, mt, co] = await Promise.all([
    supabase
      .from("item_types")
      .select("slug, label_zh, label_en, label_ms")
      .or("label_en.is.null,label_ms.is.null"),
    supabase
      .from("rooms")
      .select("slug, label_zh, label_en, label_ms")
      .or("label_en.is.null,label_ms.is.null"),
    supabase
      .from("styles")
      .select("slug, label_zh, label_en, label_ms")
      .or("label_en.is.null,label_ms.is.null"),
    supabase
      .from("materials")
      .select("slug, label_zh, label_en, label_ms")
      .or("label_en.is.null,label_ms.is.null"),
    supabase
      .from("colors")
      .select("slug, label_zh, label_en, label_ms")
      .or("label_en.is.null,label_ms.is.null"),
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
        label_zh: r.label_zh,
        need_en: r.label_en == null,
        need_ms: r.label_ms == null,
      }),
    ),
    ...(rm.data ?? []).map(
      (r): TranslateJob => ({
        kind: "rooms",
        slug: r.slug,
        label_zh: r.label_zh,
        need_en: r.label_en == null,
        need_ms: r.label_ms == null,
      }),
    ),
    ...(st.data ?? []).map(
      (r): TranslateJob => ({
        kind: "styles",
        slug: r.slug,
        label_zh: r.label_zh,
        need_en: r.label_en == null,
        need_ms: r.label_ms == null,
      }),
    ),
    ...(mt.data ?? []).map(
      (r): TranslateJob => ({
        kind: "materials",
        slug: r.slug,
        label_zh: r.label_zh,
        need_en: r.label_en == null,
        need_ms: r.label_ms == null,
      }),
    ),
    ...(co.data ?? []).map(
      (r): TranslateJob => ({
        kind: "colors",
        slug: r.slug,
        label_zh: r.label_zh,
        need_en: r.label_en == null,
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
        if (!t) continue; // Claude dropped a row, skip silently — the
        // next run will pick it up because it's still null.

        const patch: { label_en?: string; label_ms?: string } = {};
        if (job.need_en) patch.label_en = t.label_en;
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
