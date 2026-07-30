"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { suggestDimsAndMounting } from "@/lib/ai/suggest-dims";
import { isSceneCoverUrl } from "@/lib/scene-cover-url";
import {
  MOUNTING_SCENE_RULES,
  MOUNTING_ALIASES,
} from "@config/mounting-scene-rules";

/**
 * PB-B — AI suggest dims/mounting (SUGGESTION only) + adopt (the write).
 * The two are split on purpose: the AI call NEVER writes; a write happens ONLY
 * on Jym's explicit adopt, and it stamps attributes.dims_source =
 * 'ai_suggested_human_approved' for error attribution.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_MOUNTINGS = new Set(Object.keys(MOUNTING_SCENE_RULES));

export type SuggestResult =
  | {
      ok: true;
      length: number | null;
      width: number | null;
      height: number | null;
      /** normalized enum value, or null when the model couldn't determine it. */
      mounting: string | null;
      /** true when the model returned "unknown" OR a value outside the enum —
       *  UI shows "AI 无法判定" and offers no mounting to adopt. */
      mountingUndeterminable: boolean;
      rationale: string;
    }
  | { ok: false; error: string; code?: "quota" };

/** Normalize the model's raw mounting against enum + alias table. */
function normalizeMounting(raw: string | null): {
  value: string | null;
  undeterminable: boolean;
} {
  const m = (raw ?? "").trim().toLowerCase();
  if (!m || m === "unknown") return { value: null, undeterminable: true };
  const norm = MOUNTING_ALIASES[m] ?? m;
  if (VALID_MOUNTINGS.has(norm)) return { value: norm, undeterminable: false };
  return { value: null, undeterminable: true }; // out-of-enum ⇒ AI 无法判定
}

/** The clean white-bg product cutout for the vision call (never a /scene- cover). */
async function productImageUrl(
  supabase: ReturnType<typeof createServiceRoleClient>,
  productId: string,
  thumbnail: string | null,
): Promise<string | null> {
  const { data } = await supabase
    .from("product_images")
    .select("cutout_image_url, image_kind, is_primary, state")
    .eq("product_id", productId)
    .eq("state", "cutout_approved");
  const rows = data ?? [];
  const clean = (r: (typeof rows)[number]) =>
    r.cutout_image_url &&
    r.image_kind === "cutout" &&
    !isSceneCoverUrl(r.cutout_image_url);
  const pick =
    rows.find((r) => r.is_primary && clean(r)) ?? rows.find(clean);
  return pick?.cutout_image_url ?? thumbnail ?? null;
}

export async function suggestProductDimsMounting(
  productId: string,
): Promise<SuggestResult> {
  await requireAdmin();
  if (!UUID_RE.test(productId)) return { ok: false, error: "invalid product id" };
  const supabase = createServiceRoleClient();
  const { data: p } = await supabase
    .from("products")
    .select("id, name, item_type, thumbnail_url")
    .eq("id", productId)
    .maybeSingle();
  if (!p) return { ok: false, error: "product not found" };
  const img = await productImageUrl(supabase, productId, p.thumbnail_url);
  if (!img) return { ok: false, error: "no product image to analyze" };

  try {
    const s = await suggestDimsAndMounting({
      imageUrl: img,
      name: p.name,
      itemType: p.item_type,
    });
    const mn = normalizeMounting(s.mounting);
    return {
      ok: true,
      length: s.length,
      width: s.width,
      height: s.height,
      mounting: mn.value,
      mountingUndeterminable: mn.undeterminable,
      rationale: s.rationale,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: msg,
      code: /quota|rate limit|429/i.test(msg) ? "quota" : undefined,
    };
  }
}

export type AdoptValues = {
  length?: number | null;
  width?: number | null;
  height?: number | null;
  mounting?: string | null;
};

/**
 * Write the values Jym approved. Only provided axes overwrite (others keep
 * their current value); mounting is only accepted if it normalizes into the
 * enum. Stamps dims_source='ai_suggested_human_approved' whenever any dimension
 * is written — the error-attribution marker.
 */
export async function adoptSuggestedDimsMounting(
  productId: string,
  values: AdoptValues,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  if (!UUID_RE.test(productId)) return { ok: false, error: "invalid product id" };
  const supabase = createServiceRoleClient();
  const { data: p } = await supabase
    .from("products")
    .select("dimensions_mm, attributes")
    .eq("id", productId)
    .maybeSingle();
  if (!p) return { ok: false, error: "product not found" };

  const num = (v: number | null | undefined): number | null =>
    typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 10_000
      ? Math.round(v)
      : null;

  const cur = (p.dimensions_mm ?? {}) as Record<string, number | null>;
  const dimsChanged =
    values.length !== undefined ||
    values.width !== undefined ||
    values.height !== undefined;
  const nextDims: Record<string, number> = {};
  for (const a of ["length", "width", "height"] as const) {
    const provided = values[a];
    const v =
      provided !== undefined
        ? num(provided)
        : typeof cur[a] === "number"
          ? cur[a]
          : null;
    if (v) nextDims[a] = v;
  }

  const update: Record<string, unknown> = {};
  if (dimsChanged) {
    update.dimensions_mm = Object.keys(nextDims).length > 0 ? nextDims : null;
  }

  const attrs = { ...((p.attributes as Record<string, unknown>) ?? {}) };
  let attrsTouched = false;
  if (values.mounting) {
    const norm = MOUNTING_ALIASES[values.mounting] ?? values.mounting;
    if (VALID_MOUNTINGS.has(norm)) {
      attrs.mounting = norm;
      attrsTouched = true;
    }
  }
  if (dimsChanged) {
    attrs.dims_source = "ai_suggested_human_approved";
    attrsTouched = true;
  }
  if (attrsTouched) update.attributes = attrs;

  if (Object.keys(update).length === 0) {
    return { ok: false, error: "nothing to adopt" };
  }
  const { error } = await supabase
    .from("products")
    .update(update as never)
    .eq("id", productId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin");
  revalidatePath(`/product/${productId}`);
  return { ok: true };
}
