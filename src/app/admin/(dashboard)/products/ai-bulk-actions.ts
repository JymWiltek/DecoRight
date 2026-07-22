"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  loadValidSlugs,
  findSkuCollision,
  isUnnamedProduct,
} from "@/lib/admin/product-validation";
import { guardDimensions } from "@/lib/admin/dimension-guard";
import { normalizeBrand } from "@/lib/admin/brand-normalize";
import {
  findNameConflict,
  nameConflictMessage,
  NAME_CONFLICT_KEY,
} from "@config/name-conflict-rules";
import { maybeGenerateSceneCover } from "@/lib/scene-cover";
import { isSceneCoverUrl } from "@/lib/scene-cover-url";
import { runSpecParseV2 } from "./actions";

/**
 * PB4 item 4 — the TWO SEPARATE bulk-AI actions the operator drives from the
 * product list. Kept apart on purpose: spec-read is cheap, scene-gen is ~5-10×
 * pricier, and Jym has burned quota before, so he must be able to run the cheap
 * one without triggering the expensive one. The client (BulkAiPanel) enforces
 * the "run 1 sample first, then confirm the batch" flow and stops the whole
 * batch on a quota error — each action here does ONE product and reports what
 * it did + the REAL OpenAI cost of that call.
 *
 * Both reuse the EXISTING AI paths (runSpecParseV2 / maybeGenerateSceneCover) —
 * no new model-call logic.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isQuotaError(msg: string): boolean {
  return /quota|insufficient|429|rate.?limit|exceeded your current/i.test(msg);
}

export type BulkAiOutcome =
  | { ok: true; productId: string; filled: string[]; warnings: string[]; costUsd: number }
  | { ok: false; productId: string; code: "quota" | "error"; error: string };

const isBlankStr = (v: unknown) => v == null || String(v).trim() === "";
const isBlankArr = (v: unknown) => !Array.isArray(v) || v.length === 0;

/**
 * Button A — "Run AI · read specs". Reuses runSpecParseV2 (the exact edit-page
 * parser), then FILLS ONLY CURRENTLY-EMPTY fields (never overwrites existing
 * data), validating slugs, guarding dimensions against the per-category caps
 * (item 5 layer 2), and skipping a SKU that would collide (reuses
 * findSkuCollision). Returns the real per-call USD cost.
 */
export async function runSpecParseAndApply(
  productId: string,
): Promise<BulkAiOutcome> {
  await requireAdmin();
  if (!UUID_RE.test(productId)) {
    return { ok: false, productId, code: "error", error: "invalid id" };
  }

  const r = await runSpecParseV2(productId);
  if (!r.ok) {
    return {
      ok: false,
      productId,
      code: isQuotaError(r.error) ? "quota" : "error",
      error: r.error,
    };
  }

  const supabase = createServiceRoleClient();
  const { data: cur } = await supabase
    .from("products")
    .select(
      "name,brand,sku_id,description,weight_kg,price_myr,price_original_myr,dimensions_mm,item_type,subtype_slug,room_slugs,styles,colors,materials,attributes,ai_filled_fields,missing_fields",
    )
    .eq("id", productId)
    .maybeSingle();
  if (!cur) {
    return { ok: false, productId, code: "error", error: "product not found" };
  }

  const valid = await loadValidSlugs();
  const f = r.fields;
  const updates: Record<string, unknown> = {};
  const filled: string[] = [];
  const warnings: string[] = [];
  let nameConflictFlagged = false;

  // name — fill when the product is still UNNAMED. "Unnamed" includes the
  // auto-created "Untitled product" placeholder, not just null/"". Guarding on
  // isBlankStr here was the bug: every draft starts at "Untitled product",
  // which is non-blank, so the AI-parsed name was silently discarded while
  // description/sku/item_type/etc. all wrote fine (19 products in that state).
  // A real operator-chosen name is still never overwritten.
  if (f.name && isUnnamedProduct(cur.name)) {
    updates.name = f.name;
    filled.push("name");
    // Report, never decide. Manufacturer sheets carry names like "Wall Hung
    // Counter Top Basin"; the AI transcribes the contradiction faithfully. We
    // still write it (a batch must not stall on a naming argument) but name it
    // in the result and leave a marker on the row for Jym to adjudicate.
    const conflict = findNameConflict(f.name);
    if (conflict) {
      warnings.push(nameConflictMessage(f.name, conflict));
      nameConflictFlagged = true;
    }
  }
  // brand goes through the casing gate too — GPT reads whatever the spec sheet
  // printed ("saniware", "Saniware"), and without this the AI itself becomes a
  // source of new case variants.
  if (f.brand && isBlankStr(cur.brand)) { updates.brand = await normalizeBrand(f.brand); filled.push("brand"); }
  if (f.description && isBlankStr(cur.description)) { updates.description = f.description; filled.push("description"); }
  if (f.weight_kg != null && cur.weight_kg == null) { updates.weight_kg = f.weight_kg; filled.push("weight"); }
  if (f.price_myr != null && cur.price_myr == null) { updates.price_myr = f.price_myr; filled.push("price"); }
  if (f.price_original_myr != null && cur.price_original_myr == null) { updates.price_original_myr = f.price_original_myr; filled.push("price_original"); }

  // SKU — fill only if empty AND it wouldn't collide with another product.
  if (f.sku_id && isBlankStr(cur.sku_id)) {
    const clash = await findSkuCollision(f.sku_id, productId);
    if (clash) {
      warnings.push(`SKU "${f.sku_id}" skipped — already used by "${clash.name}".`);
    } else {
      updates.sku_id = f.sku_id;
      filled.push("sku");
    }
  }

  // item_type / subtype — validate against taxonomy; subtype must match the
  // effective item_type.
  let effItem = cur.item_type as string | null;
  if (f.item_type && isBlankStr(cur.item_type) && valid.itemTypes.has(f.item_type)) {
    updates.item_type = f.item_type;
    effItem = f.item_type;
    filled.push("item_type");
  }
  if (
    f.subtype_slug &&
    isBlankStr(cur.subtype_slug) &&
    effItem &&
    valid.subtypesByItemType.get(effItem)?.has(f.subtype_slug)
  ) {
    updates.subtype_slug = f.subtype_slug;
    filled.push("subtype");
  }

  const arrFill = (
    key: string,
    dbKey: string,
    set: Set<string>,
    aiArr: string[],
    curArr: unknown,
  ) => {
    if (!isBlankArr(curArr) || aiArr.length === 0) return;
    const clean = aiArr.filter((x) => set.has(x));
    if (clean.length) {
      updates[dbKey] = clean;
      filled.push(key);
    }
  };
  arrFill("rooms", "room_slugs", valid.rooms, f.room_slugs, cur.room_slugs);
  arrFill("styles", "styles", valid.styles, f.styles, cur.styles);
  arrFill("colors", "colors", valid.colors, f.colors, cur.colors);
  arrFill("materials", "materials", valid.materials, f.materials, cur.materials);

  // Dimensions — item 5: cap-guard, then fill only if the product has none.
  const anyAiDim = f.dim_length != null || f.dim_width != null || f.dim_height != null;
  const curDims = cur.dimensions_mm as { length?: number; width?: number; height?: number } | null;
  const curHasDims = !!curDims && (curDims.length || curDims.width || curDims.height);
  if (anyAiDim && !curHasDims) {
    const g = guardDimensions(
      { length: f.dim_length, width: f.dim_width, height: f.dim_height },
      effItem,
    );
    warnings.push(...g.warnings);
    if (Object.keys(g.dims).length > 0) {
      updates.dimensions_mm = g.dims;
      filled.push("dimensions");
    }
  }

  // mounting → attributes.mounting (merge, don't clobber other attributes).
  const curMounting =
    cur.attributes && typeof cur.attributes === "object"
      ? (cur.attributes as Record<string, unknown>).mounting
      : undefined;
  if (f.mounting && isBlankStr(curMounting)) {
    updates.attributes = {
      ...((cur.attributes as Record<string, unknown>) ?? {}),
      mounting: f.mounting,
    };
    filled.push("mounting");
  }

  // Spec sheets the parse auto-tagged on this product — reported so a batch
  // shows how many images stopped leaking onto the storefront.
  if (r.specSheetTagged > 0) {
    warnings.push(`自动标记 spec_sheet:${r.specSheetTagged} 张`);
  }

  if (filled.length > 0) {
    // Track which fields AI filled (append, dedupe).
    const prevAi = Array.isArray(cur.ai_filled_fields) ? cur.ai_filled_fields : [];
    updates.ai_filled_fields = [...new Set([...prevAi, ...filled])];
    if (nameConflictFlagged) {
      // Rides the same missing_fields pseudo-key channel as
      // `<field>_low_confidence` / `publish_gate_*` — no new column needed.
      const prevMissing = Array.isArray(cur.missing_fields) ? cur.missing_fields : [];
      updates.missing_fields = [...new Set([...prevMissing, NAME_CONFLICT_KEY])];
    }
    const { error } = await supabase
      .from("products")
      // Dynamically-built partial update; keys are all real product columns.
      .update(updates as never)
      .eq("id", productId);
    if (error) {
      return { ok: false, productId, code: "error", error: error.message };
    }
    revalidatePath("/admin");
    revalidatePath(`/product/${productId}`);
  }

  return { ok: true, productId, filled, warnings, costUsd: r.debug.costUsd };
}

/**
 * Button B — "Generate scene images". Reuses maybeGenerateSceneCover (the exact
 * existing scene pipeline). Runs ONE product synchronously so the client's
 * sample-first / progress / abort flow works the same as button A. Scene image
 * generation is billed by OpenAI per image (not per token), so there is no
 * per-call token cost to read — costUsd is returned as 0 and the UI shows the
 * image count + directs Jym to the OpenAI dashboard for the exact figure
 * (never a fabricated/hardcoded number).
 */
export async function runSceneGenForProduct(
  productId: string,
  regenerate = false,
): Promise<BulkAiOutcome> {
  await requireAdmin();
  if (!UUID_RE.test(productId)) {
    return { ok: false, productId, code: "error", error: "invalid id" };
  }
  try {
    // Returns done | skipped; THROWS on a real generation failure.
    // regenerate=true forces overwrite of an existing scene cover.
    const res = await maybeGenerateSceneCover(productId, { force: regenerate });
    revalidatePath("/admin");
    revalidatePath(`/product/${productId}`);
    return {
      ok: true,
      productId,
      filled: res.status === "done" ? ["scene_cover"] : [],
      warnings:
        res.status === "skipped"
          ? [`skipped: ${res.reason}`]
          : res.note
            ? [res.note]
            : [],
      costUsd: 0,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      productId,
      code: isQuotaError(msg) ? "quota" : "error",
      error: msg,
    };
  }
}

export type AiPanelInfo = {
  /** Most-recent actual per-call cost for a spec parse (USD), or null if
   *  there's no history yet. Drives the live estimate — read from real usage,
   *  never a hardcoded rate. */
  specUnitUsd: number | null;
  /** Same for scene generation. Scene gen is billed per image and isn't
   *  token-metered, so this is usually null → the UI shows a per-image note
   *  rather than a fabricated number. */
  sceneUnitUsd: number | null;
  /** How many of the selected products already have a scene cover (so the
   *  panel can show how many scene generations are SKIPPED when "regenerate"
   *  is off). */
  withSceneCount: number;
};

/**
 * PB3-C A2 — data for the panel's live cost estimate + scene-skip count.
 * Cost units come from the api_usage history (the most recent real charge),
 * so the estimate is grounded in actuals, not a guessed rate.
 */
export async function getAiPanelInfo(ids: string[]): Promise<AiPanelInfo> {
  await requireAdmin();
  const supabase = createServiceRoleClient();
  const validIds = (Array.isArray(ids) ? ids : []).filter((x) => UUID_RE.test(x));

  const lastCost = async (services: string[]): Promise<number | null> => {
    const { data } = await supabase
      .from("api_usage")
      .select("cost_usd")
      // Some names (scene services) aren't in the service enum — they simply
      // match no rows and yield null, which is the intended "no history" path.
      .in("service", services as never)
      .gt("cost_usd", 0)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return typeof data?.cost_usd === "number" ? data.cost_usd : null;
  };

  const [specUnitUsd, sceneUnitUsd] = await Promise.all([
    lastCost(["gpt4o_vision_spec_v2", "gpt4o_vision_spec_merged", "gpt4o_vision_spec"]),
    lastCost(["scene_cover", "gpt_image_scene"]),
  ]);

  let withSceneCount = 0;
  if (validIds.length) {
    const { data } = await supabase
      .from("products")
      .select("thumbnail_url")
      .in("id", validIds);
    withSceneCount = (data ?? []).filter((p) =>
      isSceneCoverUrl(p.thumbnail_url),
    ).length;
  }

  return { specUnitUsd, sceneUnitUsd, withSceneCount };
}
