"use server";

import { requireAdmin } from "@/lib/auth/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service";
import type { ProductUpdate } from "@/lib/supabase/types";
import { absoluteUrl } from "@/lib/site-url";
import {
  loadValidSlugs,
  findSkuCollision,
} from "@/lib/admin/product-validation";
import {
  parseSpreadsheet,
  PRODUCT_EXCEL_COLUMNS,
  READONLY_COLUMN_KEYS,
  type ExcelColumnKey,
  type RawImportRow,
} from "@/lib/admin/product-excel";
import { revalidatePath } from "next/cache";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const labelOf = (k: ExcelColumnKey) =>
  PRODUCT_EXCEL_COLUMNS.find((c) => c.key === k)?.header ?? k;

// ── Plan types (all plain-serializable — crosses the server-action wire) ──

export type FieldChange = {
  col: ExcelColumnKey;
  label: string;
  before: string;
  after: string;
};

/** The resolved DB write for a matched, non-blocked row. Only editable
 *  columns; status / id / product_url are NEVER here. */
export type ResolvedUpdate = {
  name?: string;
  sku_id?: string;
  brand?: string;
  item_type?: string;
  subtype_slug?: string;
  room_slugs?: string[];
  styles?: string[];
  materials?: string[];
  colors?: string[];
  dimensions_mm?: { length?: number; width?: number; height?: number };
  price_myr?: number;
};

export type UpdateEntry = {
  productId: string;
  productName: string;
  productUrl: string;
  matchedBy: "id" | "sku";
  changes: FieldChange[];
  updates: ResolvedUpdate;
  /** Present only when the retailers column changed; resolved supplier names
   *  (authoritative replace of the product's links). */
  retailerNames?: string[];
  /** Non-fatal per-row notes (e.g. an invalid slug value that was skipped). */
  warnings: string[];
};

export type BlockedEntry = {
  rowNumber: number;
  identity: string;
  reason: string;
};

export type IgnoredReadOnly = {
  rowNumber: number;
  productLabel: string;
  col: string;
  attempted: string;
  current: string;
};

export type ImportPlan = {
  ok: true;
  fileName: string;
  toUpdate: UpdateEntry[];
  blocked: BlockedEntry[];
  ignoredReadOnly: IgnoredReadOnly[];
  stats: {
    totalRows: number;
    changedProducts: number;
    unchanged: number;
    blocked: number;
  };
};

export type ImportParseResult = ImportPlan | { ok: false; error: string };

// ── Helpers ─────────────────────────────────────────────────────────

const norm = (s: string) => s.trim().toLowerCase();
const parseMulti = (cell: string) =>
  cell
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join("") === [...b].sort().join("");

type DbProduct = {
  id: string;
  name: string | null;
  sku_id: string | null;
  brand: string | null;
  item_type: string | null;
  subtype_slug: string | null;
  room_slugs: string[] | null;
  styles: string[] | null;
  materials: string[] | null;
  colors: string[] | null;
  dimensions_mm: { length?: number; width?: number; height?: number } | null;
  price_myr: number | null;
  status: string;
};

const PRODUCT_COLS =
  "id, name, sku_id, brand, item_type, subtype_slug, room_slugs, styles, materials, colors, dimensions_mm, price_myr, status";

// ── Parse + build plan ──────────────────────────────────────────────

export async function parseImportFile(
  fd: FormData,
): Promise<ImportParseResult> {
  await requireAdmin();
  const file = fd.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file uploaded." };
  const name = file.name || "upload.xlsx";
  if (!/\.(xlsx|csv)$/i.test(name)) {
    return { ok: false, error: "Only .xlsx and .csv files are accepted." };
  }
  const data = await file.arrayBuffer();

  let sheet;
  try {
    sheet = await parseSpreadsheet(data, name);
  } catch (e) {
    return {
      ok: false,
      error: `Could not read the file: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  if (sheet.rows.length === 0) {
    return { ok: false, error: "The file has no data rows." };
  }

  const supabase = createServiceRoleClient();
  const [{ data: products }, valid, { data: suppliers }] = await Promise.all([
    supabase.from("products").select(PRODUCT_COLS),
    loadValidSlugs(),
    supabase.from("suppliers").select("id, name"),
  ]);
  const byId = new Map<string, DbProduct>();
  const bySku = new Map<string, DbProduct>();
  for (const p of (products ?? []) as DbProduct[]) {
    byId.set(p.id, p);
    if (p.sku_id && p.sku_id.trim()) bySku.set(norm(p.sku_id), p);
  }
  // supplier name (normalized) → canonical name (for authoritative replace).
  const supplierByName = new Map<string, string>();
  for (const s of suppliers ?? []) supplierByName.set(norm(s.name), s.name);

  // Load the current retailer names per product (for retailers before/after).
  const { data: links } = await supabase
    .from("product_suppliers")
    .select("product_id, supplier_id");
  const supplierNameById = new Map((suppliers ?? []).map((s) => [s.id, s.name]));
  const retailersByProduct = new Map<string, string[]>();
  for (const l of links ?? []) {
    const nm = supplierNameById.get(l.supplier_id);
    if (!nm) continue;
    const arr = retailersByProduct.get(l.product_id) ?? [];
    arr.push(nm);
    retailersByProduct.set(l.product_id, arr);
  }

  const toUpdate: UpdateEntry[] = [];
  const blocked: BlockedEntry[] = [];
  const ignoredReadOnly: IgnoredReadOnly[] = [];

  // First pass — resolve identity + build a tentative change set per row.
  // We defer SKU-collision judgement until we know every row's NEW sku, so
  // intra-file duplicates (two rows both changing to the same sku) can be
  // caught. Rows changing a sku are keyed here; rows that leave sku unchanged
  // (including the 2 pre-existing dup groups on a no-op re-import) are NOT
  // part of the collision check.
  type Pending = {
    row: RawImportRow;
    product: DbProduct;
    matchedBy: "id" | "sku";
    changes: FieldChange[];
    updates: ResolvedUpdate;
    retailerNames?: string[];
    warnings: string[];
    newSkuNorm?: string; // set only when sku is a CHANGE
    newSkuRaw?: string;
  };
  const pending: Pending[] = [];

  for (const row of sheet.rows) {
    const idCell = row.cells.id ?? "";
    const skuCell = row.cells.sku ?? "";

    // ── Identify the product (id first, then sku) ──
    let product: DbProduct | undefined;
    let matchedBy: "id" | "sku";
    if (idCell) {
      if (!UUID_RE.test(idCell) || !byId.has(idCell)) {
        blocked.push({
          rowNumber: row.rowNumber,
          identity: idCell,
          reason: `id "${idCell}" doesn't match any product — nothing updated (rows are never created here).`,
        });
        continue;
      }
      product = byId.get(idCell)!;
      matchedBy = "id";
    } else if (skuCell) {
      const hit = bySku.get(norm(skuCell));
      if (!hit) {
        blocked.push({
          rowNumber: row.rowNumber,
          identity: skuCell,
          reason: `no product has SKU "${skuCell}" (id column was blank) — can't identify the row.`,
        });
        continue;
      }
      product = hit;
      matchedBy = "sku";
    } else {
      blocked.push({
        rowNumber: row.rowNumber,
        identity: "(blank)",
        reason: "row has neither id nor SKU — can't identify which product to update.",
      });
      continue;
    }

    const productUrl = absoluteUrl(`/product/${product.id}`);

    // ── Read-only columns: warn if the operator changed one ──
    for (const rk of READONLY_COLUMN_KEYS) {
      const cell = (row.cells[rk] ?? "").trim();
      if (!cell) continue;
      const current =
        rk === "id"
          ? product.id
          : rk === "product_url"
            ? productUrl
            : product.status;
      if (norm(cell) !== norm(String(current))) {
        ignoredReadOnly.push({
          rowNumber: row.rowNumber,
          productLabel: product.name ?? product.id.slice(0, 8),
          col: labelOf(rk),
          attempted: cell,
          current: String(current),
        });
      }
    }

    // ── Editable columns → changes ──
    const changes: FieldChange[] = [];
    const updates: ResolvedUpdate = {};
    const warnings: string[] = [];
    let retailerNames: string[] | undefined;
    let newSkuNorm: string | undefined;
    let newSkuRaw: string | undefined;

    const has = (k: ExcelColumnKey) => (row.cells[k] ?? "").trim().length > 0;
    const cell = (k: ExcelColumnKey) => (row.cells[k] ?? "").trim();

    // name / brand — free text.
    if (has("name") && cell("name") !== (product.name ?? "")) {
      updates.name = cell("name");
      changes.push({ col: "name", label: labelOf("name"), before: product.name ?? "", after: cell("name") });
    }
    if (has("brand") && cell("brand") !== (product.brand ?? "")) {
      updates.brand = cell("brand");
      changes.push({ col: "brand", label: labelOf("brand"), before: product.brand ?? "", after: cell("brand") });
    }

    // sku — change detected here; collision judged in the second pass.
    if (has("sku") && norm(cell("sku")) !== norm(product.sku_id ?? "")) {
      newSkuNorm = norm(cell("sku"));
      newSkuRaw = cell("sku");
      // provisional change; may be revoked if it collides.
      changes.push({ col: "sku", label: labelOf("sku"), before: product.sku_id ?? "", after: cell("sku") });
      updates.sku_id = cell("sku");
    }

    // item_type — validate against taxonomy.
    let effectiveItemType = product.item_type;
    if (has("item_type") && cell("item_type") !== (product.item_type ?? "")) {
      if (valid.itemTypes.has(cell("item_type"))) {
        updates.item_type = cell("item_type");
        effectiveItemType = cell("item_type");
        changes.push({ col: "item_type", label: labelOf("item_type"), before: product.item_type ?? "", after: cell("item_type") });
      } else {
        warnings.push(`item_type "${cell("item_type")}" is not a known type — skipped.`);
      }
    }

    // subtype — validate against the effective item_type's allowed set.
    if (has("subtype") && cell("subtype") !== (product.subtype_slug ?? "")) {
      const allowed = effectiveItemType
        ? valid.subtypesByItemType.get(effectiveItemType)
        : undefined;
      if (allowed?.has(cell("subtype"))) {
        updates.subtype_slug = cell("subtype");
        changes.push({ col: "subtype", label: labelOf("subtype"), before: product.subtype_slug ?? "", after: cell("subtype") });
      } else {
        warnings.push(`subtype "${cell("subtype")}" is not valid for item_type "${effectiveItemType ?? "(none)"}" — skipped.`);
      }
    }

    // multi-value taxonomy arrays.
    const multiFields: {
      key: "rooms" | "styles" | "materials" | "colors";
      dbKey: "room_slugs" | "styles" | "materials" | "colors";
      set: Set<string>;
      current: string[];
    }[] = [
      { key: "rooms", dbKey: "room_slugs", set: valid.rooms, current: product.room_slugs ?? [] },
      { key: "styles", dbKey: "styles", set: valid.styles, current: product.styles ?? [] },
      { key: "materials", dbKey: "materials", set: valid.materials, current: product.materials ?? [] },
      { key: "colors", dbKey: "colors", set: valid.colors, current: product.colors ?? [] },
    ];
    for (const mf of multiFields) {
      if (!has(mf.key)) continue;
      const wanted = parseMulti(cell(mf.key));
      const invalid = wanted.filter((v) => !mf.set.has(v));
      if (invalid.length) {
        warnings.push(`${mf.key}: unknown value(s) ${invalid.map((v) => `"${v}"`).join(", ")} — ${mf.key} left unchanged for this row.`);
        continue; // don't half-apply an authoritative array replace
      }
      if (!sameSet(wanted, mf.current)) {
        updates[mf.dbKey] = wanted;
        changes.push({ col: mf.key, label: labelOf(mf.key), before: mf.current.join(", "), after: wanted.join(", ") });
      }
    }

    // dimensions → merge into one object; each dim is its own change row.
    const dimSpecs: { key: "length_mm" | "width_mm" | "height_mm"; dim: "length" | "width" | "height" }[] = [
      { key: "length_mm", dim: "length" },
      { key: "width_mm", dim: "width" },
      { key: "height_mm", dim: "height" },
    ];
    let dimsChanged = false;
    const newDims = { ...(product.dimensions_mm ?? {}) } as { length?: number; width?: number; height?: number };
    for (const ds of dimSpecs) {
      if (!has(ds.key)) continue;
      const n = Number(cell(ds.key));
      if (!Number.isFinite(n) || n < 0) {
        warnings.push(`${ds.key} "${cell(ds.key)}" is not a valid number — skipped.`);
        continue;
      }
      const currentDim = product.dimensions_mm?.[ds.dim];
      if (currentDim !== n) {
        newDims[ds.dim] = n;
        dimsChanged = true;
        changes.push({ col: ds.key, label: labelOf(ds.key), before: currentDim != null ? String(currentDim) : "", after: String(n) });
      }
    }
    if (dimsChanged) updates.dimensions_mm = newDims;

    // price.
    if (has("price")) {
      const n = Number(cell("price"));
      if (!Number.isFinite(n) || n < 0) {
        warnings.push(`price "${cell("price")}" is not a valid number — skipped.`);
      } else if (n !== (product.price_myr ?? null)) {
        updates.price_myr = n;
        changes.push({ col: "price", label: labelOf("price"), before: product.price_myr != null ? String(product.price_myr) : "", after: String(n) });
      }
    }

    // retailers — authoritative replace; resolve names → canonical.
    if (has("retailers")) {
      const wantedRaw = parseMulti(cell("retailers"));
      const resolved: string[] = [];
      const unknown: string[] = [];
      for (const nm of wantedRaw) {
        const canonical = supplierByName.get(norm(nm));
        if (canonical) resolved.push(canonical);
        else unknown.push(nm);
      }
      if (unknown.length) {
        warnings.push(`retailers: unknown supplier(s) ${unknown.map((v) => `"${v}"`).join(", ")} — retailers left unchanged for this row. (Add the supplier in Admin › Suppliers first.)`);
      } else {
        const current = (retailersByProduct.get(product.id) ?? []);
        if (!sameSet(resolved, current)) {
          retailerNames = resolved;
          changes.push({ col: "retailers", label: labelOf("retailers"), before: current.join(", "), after: resolved.join(", ") });
        }
      }
    }

    pending.push({ row, product, matchedBy, changes, updates, retailerNames, warnings, newSkuNorm, newSkuRaw });
  }

  // ── Second pass: SKU collisions (intra-file + DB), only for CHANGED skus ──
  const changedSkuRows = pending.filter((p) => p.newSkuNorm);
  const skuGroups = new Map<string, Pending[]>();
  for (const p of changedSkuRows) {
    const g = skuGroups.get(p.newSkuNorm!) ?? [];
    g.push(p);
    skuGroups.set(p.newSkuNorm!, g);
  }
  const droppedSku = new Set<Pending>();
  // intra-file duplicates.
  for (const [skuNorm, group] of skuGroups) {
    if (group.length > 1) {
      const rowsList = group.map((g) => `row ${g.row.rowNumber}`).join(", ");
      for (const g of group) {
        blocked.push({
          rowNumber: g.row.rowNumber,
          identity: g.newSkuRaw ?? skuNorm,
          reason: `SKU "${g.newSkuRaw}" is used on multiple rows in this file (${rowsList}) — SKUs must be unique. Fix the duplicates and re-upload.`,
        });
        droppedSku.add(g);
      }
    }
  }
  // DB collisions (for the non-intra-file-dup changed rows).
  for (const p of changedSkuRows) {
    if (droppedSku.has(p)) continue;
    const clash = await findSkuCollision(p.newSkuRaw, p.product.id);
    if (clash) {
      blocked.push({
        rowNumber: p.row.rowNumber,
        identity: p.newSkuRaw ?? "",
        reason: `SKU "${p.newSkuRaw}" is already used by "${clash.name}" (${clash.id.slice(0, 8)}). Change one of them.`,
      });
      droppedSku.add(p);
    }
  }

  // ── Assemble the final plan ──
  for (const p of pending) {
    if (droppedSku.has(p)) continue; // whole row blocked by a sku collision
    if (p.changes.length === 0 && !p.retailerNames && p.warnings.length === 0) {
      continue; // unchanged — don't show
    }
    // If only warnings (no actual changes / retailer replace), still skip from
    // the update list but surface the warnings by attaching to a no-op entry?
    // Simpler: only list entries that have a real change; warnings without a
    // change are dropped (they describe a value the operator can just re-enter
    // correctly). Keep an entry if it has any concrete change.
    const hasConcrete = p.changes.length > 0 || !!p.retailerNames;
    if (!hasConcrete) continue;
    toUpdate.push({
      productId: p.product.id,
      productName: p.product.name ?? p.product.id.slice(0, 8),
      productUrl: absoluteUrl(`/product/${p.product.id}`),
      matchedBy: p.matchedBy,
      changes: p.changes,
      updates: p.updates,
      retailerNames: p.retailerNames,
      warnings: p.warnings,
    });
  }

  const unchanged =
    sheet.rows.length - toUpdate.length - blocked.length;
  return {
    ok: true,
    fileName: name,
    toUpdate,
    blocked,
    ignoredReadOnly,
    stats: {
      totalRows: sheet.rows.length,
      changedProducts: toUpdate.length,
      unchanged: Math.max(0, unchanged),
      blocked: blocked.length,
    },
  };
}

// ── Apply (after Jym confirms) ──────────────────────────────────────

export type ApplyResult =
  | { ok: true; updated: number; skipped: { productId: string; reason: string }[] }
  | { ok: false; error: string };

/**
 * Write the confirmed changes. Re-validates authoritatively — the client
 * holds the plan between preview and confirm, so we NEVER trust it blindly:
 * we re-check existence, re-run findSkuCollision (fresh — another edit may
 * have taken the SKU), re-validate every slug, re-resolve retailer names, and
 * structurally whitelist columns so status / id can't sneak through.
 *
 * ⚠️ EMPTY = DON'T TOUCH is enforced upstream (parseImportFile only emits a
 * field when its cell was non-empty AND changed). This is UPDATE-ONLY: no row
 * here can create or delete a product. Do NOT "fix" empty-clears-the-field —
 * clearing a field is a deliberate single-product-edit action, not a bulk one.
 */
export async function applyImport(entries: UpdateEntry[]): Promise<ApplyResult> {
  await requireAdmin();
  if (!Array.isArray(entries) || entries.length === 0) {
    return { ok: false, error: "Nothing to apply." };
  }
  const supabase = createServiceRoleClient();
  const valid = await loadValidSlugs();
  const { data: suppliers } = await supabase.from("suppliers").select("id, name");
  const supplierIdByName = new Map(
    (suppliers ?? []).map((s) => [s.name.trim().toLowerCase(), s.id]),
  );

  let updated = 0;
  const skipped: { productId: string; reason: string }[] = [];

  for (const e of entries) {
    if (!UUID_RE.test(e.productId)) {
      skipped.push({ productId: e.productId, reason: "invalid id" });
      continue;
    }
    const { data: current } = await supabase
      .from("products")
      .select("id")
      .eq("id", e.productId)
      .maybeSingle();
    if (!current) {
      skipped.push({ productId: e.productId, reason: "product no longer exists" });
      continue;
    }

    // Whitelist + re-validate each field from the submitted updates.
    const u = e.updates ?? {};
    const write: ProductUpdate = {};
    if (typeof u.name === "string" && u.name.trim()) write.name = u.name.trim();
    if (typeof u.brand === "string") write.brand = u.brand.trim();
    if (typeof u.price_myr === "number" && Number.isFinite(u.price_myr) && u.price_myr >= 0)
      write.price_myr = u.price_myr;
    if (u.dimensions_mm && typeof u.dimensions_mm === "object")
      write.dimensions_mm = u.dimensions_mm;

    // sku — re-check collision fresh.
    if (typeof u.sku_id === "string" && u.sku_id.trim()) {
      const clash = await findSkuCollision(u.sku_id, e.productId);
      if (clash) {
        skipped.push({
          productId: e.productId,
          reason: `SKU now used by "${clash.name}" (${clash.id.slice(0, 8)})`,
        });
        continue; // skip the WHOLE row — its identity field is invalid
      }
      write.sku_id = u.sku_id.trim();
    }

    // slugs — re-validate.
    if (typeof u.item_type === "string" && valid.itemTypes.has(u.item_type))
      write.item_type = u.item_type;
    if (typeof u.subtype_slug === "string") {
      const it = (write.item_type as string | undefined) ?? undefined;
      const allowed = it ? valid.subtypesByItemType.get(it) : undefined;
      // If item_type wasn't (re)set in this write, validate subtype against
      // the product's existing item_type.
      if (allowed?.has(u.subtype_slug)) write.subtype_slug = u.subtype_slug;
      else if (!it) {
        const { data: prod } = await supabase
          .from("products")
          .select("item_type")
          .eq("id", e.productId)
          .single();
        const cur = prod?.item_type ?? undefined;
        if (cur && valid.subtypesByItemType.get(cur)?.has(u.subtype_slug))
          write.subtype_slug = u.subtype_slug;
      }
    }
    const arrValidate = (arr: unknown, set: Set<string>): string[] | null => {
      if (!Array.isArray(arr)) return null;
      const clean = arr.filter((x): x is string => typeof x === "string" && set.has(x));
      return clean.length === arr.length ? clean : null;
    };
    const rooms = arrValidate(u.room_slugs, valid.rooms);
    if (rooms) write.room_slugs = rooms;
    const styles = arrValidate(u.styles, valid.styles);
    if (styles) write.styles = styles;
    const materials = arrValidate(u.materials, valid.materials);
    if (materials) write.materials = materials;
    const colors = arrValidate(u.colors, valid.colors);
    if (colors) write.colors = colors;

    let touched = false;
    if (Object.keys(write).length > 0) {
      const { error } = await supabase
        .from("products")
        .update(write)
        .eq("id", e.productId);
      if (error) {
        skipped.push({ productId: e.productId, reason: error.message });
        continue;
      }
      touched = true;
    }

    // retailers — authoritative replace (delete + insert). Re-resolve names.
    if (Array.isArray(e.retailerNames)) {
      const ids: string[] = [];
      for (const nm of e.retailerNames) {
        const id = supplierIdByName.get(nm.trim().toLowerCase());
        if (id) ids.push(id);
      }
      await supabase.from("product_suppliers").delete().eq("product_id", e.productId);
      if (ids.length) {
        await supabase.from("product_suppliers").insert(
          ids.map((sid) => ({
            product_id: e.productId,
            supplier_id: sid,
            stock_status: "in_stock" as const,
            is_exclusive: false,
          })),
        );
      }
      touched = true;
    }

    if (touched) {
      updated++;
      revalidatePath(`/product/${e.productId}`);
    }
  }

  revalidatePath("/admin");
  revalidatePath("/");
  return { ok: true, updated, skipped };
}
