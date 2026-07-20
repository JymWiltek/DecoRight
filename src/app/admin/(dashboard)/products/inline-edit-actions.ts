"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  loadValidSlugs,
  findSkuCollision,
} from "@/lib/admin/product-validation";

/**
 * Per-cell inline editing on the admin product list.
 *
 * ONE action for the whole whitelist, because every field has to run the
 * SAME rules the /edit workbench runs — SKU uniqueness via findSkuCollision,
 * taxonomy slugs via loadValidSlugs. Those live in
 * src/lib/admin/product-validation.ts and are shared by updateProduct, the
 * Excel import, the bulk-AI writer and now this. No second copy of the rules,
 * so the list can't accept something /edit would reject (same anti-drift
 * principle as the publish-gate reuse in #16).
 *
 * Deliberately NOT editable here:
 *   • status  — must go through the publish gate (setProductStatusAction).
 *   • description / dimensions / weight / images / 3D / retailer — too big or
 *     too consequential for a table cell; they stay on /edit.
 *
 * Unlike the older cell actions (setProductPriceAction etc.) this RETURNS a
 * result instead of redirecting: the cell needs to render a red inline error
 * and roll its value back without navigating away and losing the operator's
 * place in a 200-row table.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The whitelist. Anything not listed here is rejected outright. */
export type InlineField =
  | "name"
  | "sku_id"
  | "brand"
  | "subtype_slug"
  | "room_slugs"
  | "styles";

const TEXT_FIELDS = new Set<InlineField>(["name", "sku_id", "brand"]);
const ARRAY_FIELDS = new Set<InlineField>(["room_slugs", "styles"]);

export type InlineEditResult =
  | { ok: true }
  | { ok: false; error: string };

export async function saveInlineFieldAction(
  productId: string,
  field: InlineField,
  value: string | string[],
): Promise<InlineEditResult> {
  await requireAdmin();
  if (!UUID_RE.test(productId)) return { ok: false, error: "Invalid product." };

  const isText = TEXT_FIELDS.has(field);
  const isArray = ARRAY_FIELDS.has(field);
  if (!isText && !isArray && field !== "subtype_slug") {
    return { ok: false, error: `Field "${field}" is not inline-editable.` };
  }
  if (isArray !== Array.isArray(value)) {
    return { ok: false, error: "Malformed value." };
  }

  const supabase = createServiceRoleClient();
  let update: Record<string, unknown>;

  if (isText || field === "subtype_slug") {
    const raw = typeof value === "string" ? value.trim() : "";

    if (field === "name") {
      // A product must keep a name — the list, the card and the storefront
      // all key off it. Clearing brand/SKU is fine; clearing the name isn't.
      if (raw === "") return { ok: false, error: "Name can't be empty." };
      update = { name: raw };
    } else if (field === "brand") {
      update = { brand: raw === "" ? null : raw };
    } else if (field === "sku_id") {
      if (raw === "") {
        update = { sku_id: null };
      } else {
        // SAME uniqueness check /edit and the Excel import run. Name the
        // clashing product so the operator can go fix the right row.
        const clash = await findSkuCollision(raw, productId);
        if (clash) {
          return {
            ok: false,
            error: `SKU "${raw}" is already used by "${clash.name}" (${clash.id.slice(0, 8)}).`,
          };
        }
        update = { sku_id: raw };
      }
    } else {
      // subtype_slug — must belong to THIS product's current item_type.
      if (raw === "") {
        update = { subtype_slug: null };
      } else {
        const { data: row } = await supabase
          .from("products")
          .select("item_type")
          .eq("id", productId)
          .maybeSingle();
        const itemType = row?.item_type ?? null;
        if (!itemType) {
          return {
            ok: false,
            error: "Pick an item type first — subtypes belong to a type.",
          };
        }
        const valid = await loadValidSlugs();
        if (!valid.subtypesByItemType.get(itemType)?.has(raw)) {
          return {
            ok: false,
            error: `"${raw}" isn't a subtype of ${itemType}.`,
          };
        }
        update = { subtype_slug: raw };
      }
    }
  } else {
    // room_slugs / styles — every entry must exist in the taxonomy.
    const arr = [...new Set((value as string[]).map((s) => s.trim()).filter(Boolean))];
    const valid = await loadValidSlugs();
    const allowed = field === "room_slugs" ? valid.rooms : valid.styles;
    const bad = arr.filter((s) => !allowed.has(s));
    if (bad.length > 0) {
      return { ok: false, error: `Unknown ${field === "room_slugs" ? "room" : "style"}: ${bad.join(", ")}` };
    }
    update = { [field]: arr };
  }

  const { error } = await supabase
    .from("products")
    // Dynamically-built single-column update; the key is whitelisted above.
    .update(update as never)
    .eq("id", productId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin");
  revalidatePath(`/product/${productId}`);
  return { ok: true };
}
