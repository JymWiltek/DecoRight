"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { glbPublicUrl, uploadThumbnail } from "@/lib/storage";
import { inferProductFields } from "@/lib/ai/infer";
import { invalidatePublishedCountsCache } from "@/lib/products";
import { runRembgForImage } from "@/lib/rembg/pipeline";
import {
  PRICE_TIERS,
  PRODUCT_STATUSES,
  type PriceTier,
  type ProductStatus,
} from "@/lib/constants/enums";
import type {
  Dimensions,
  ProductInsert,
  ProductUpdate,
} from "@/lib/supabase/types";

/** Accepted image extensions (lowercased, no leading dot). Must match
 *  the MIME→ext map in upload-actions.ts so a signed URL minted
 *  there yields an entry that passes validation here. */
const ALLOWED_IMAGE_EXTS = new Set(["jpg", "png", "webp", "gif"]);

/** Anchored UUID regex. crypto.randomUUID() emits v4; we accept any
 *  v1-5 since the server doesn't care about the version bits — just
 *  the shape. Defeats path-injection via crafted `imageId`. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RawImageEntry = { imageId: string; ext: string };

/**
 * Parse the `raw_image_entries` hidden field the client dropzone
 * appends at submit time. Shape: JSON array of `{imageId, ext}`.
 *
 * Validation is tight: uuid-shaped id + known extension. Anything
 * else is dropped silently — a crafted POST can't wedge a `../`
 * path traversal into raw_image_url because we reconstruct the
 * path server-side as `<productId>/<imageId>.<ext>` from these
 * validated pieces.
 */
function parseRawImageEntries(fd: FormData): RawImageEntry[] {
  const raw = fd.get("raw_image_entries");
  if (typeof raw !== "string" || !raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: RawImageEntry[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.imageId === "string" ? o.imageId : null;
    const ext =
      typeof o.ext === "string" ? o.ext.toLowerCase().replace(/^\./, "") : null;
    if (!id || !ext) continue;
    if (!UUID_RE.test(id)) continue;
    if (!ALLOWED_IMAGE_EXTS.has(ext)) continue;
    out.push({ imageId: id, ext });
  }
  return out;
}

// Taxonomy slugs are validated against the live DB tables — not a
// hard-coded list — so operators can add new item types / rooms /
// styles / colors / regions without a code change.
async function loadValidSlugs(): Promise<{
  itemTypes: Set<string>;
  /** item_type slug → set of allowed subtype slugs. (item_type,
   *  subtype) must match together; this map lets us validate the
   *  pair in one lookup. */
  subtypesByItemType: Map<string, Set<string>>;
  rooms: Set<string>;
  styles: Set<string>;
  materials: Set<string>;
  colors: Set<string>;
  regions: Set<string>;
}> {
  const supabase = createServiceRoleClient();
  const [it, sub, rm, st, mt, co, rg] = await Promise.all([
    supabase.from("item_types").select("slug"),
    supabase.from("item_subtypes").select("slug,item_type_slug"),
    supabase.from("rooms").select("slug"),
    supabase.from("styles").select("slug"),
    supabase.from("materials").select("slug"),
    supabase.from("colors").select("slug"),
    supabase.from("regions").select("slug"),
  ]);
  const subtypesByItemType = new Map<string, Set<string>>();
  for (const row of sub.data ?? []) {
    const set = subtypesByItemType.get(row.item_type_slug) ?? new Set<string>();
    set.add(row.slug);
    subtypesByItemType.set(row.item_type_slug, set);
  }
  return {
    itemTypes: new Set((it.data ?? []).map((r) => r.slug)),
    subtypesByItemType,
    rooms: new Set((rm.data ?? []).map((r) => r.slug)),
    styles: new Set((st.data ?? []).map((r) => r.slug)),
    materials: new Set((mt.data ?? []).map((r) => r.slug)),
    colors: new Set((co.data ?? []).map((r) => r.slug)),
    regions: new Set((rg.data ?? []).map((r) => r.slug)),
  };
}

function str(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function num(fd: FormData, key: string): number | null {
  const v = str(fd, key);
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickOne<T extends readonly string[]>(
  v: string | null,
  allowed: T,
): T[number] | null {
  if (!v) return null;
  return (allowed as readonly string[]).includes(v) ? (v as T[number]) : null;
}

function pickManyFromSet(
  fd: FormData,
  key: string,
  allowed: Set<string>,
): string[] {
  const raw = fd.getAll(key).map((x) => x.toString());
  return raw.filter((s) => allowed.has(s));
}

function pickOneFromSet(v: string | null, allowed: Set<string>): string | null {
  if (!v) return null;
  return allowed.has(v) ? v : null;
}

function parseDimensions(fd: FormData): Dimensions | null {
  const l = num(fd, "dim_length");
  const w = num(fd, "dim_width");
  const h = num(fd, "dim_height");
  if (l == null && w == null && h == null) return null;
  const out: Dimensions = {};
  if (l != null) out.length = l;
  if (w != null) out.width = w;
  if (h != null) out.height = h;
  return out;
}

async function parsePayload(fd: FormData): Promise<Omit<ProductInsert, "id">> {
  const valid = await loadValidSlugs();

  const name = str(fd, "name");
  if (!name) throw new Error("name required");

  const itemType = pickOneFromSet(str(fd, "item_type"), valid.itemTypes);
  // Subtype must belong to the picked item_type. If item_type is null
  // OR the subtype string isn't in that item_type's subtypes, drop it
  // silently (rather than error) — the trigger in migration 0011 also
  // enforces this so the DB is the final word.
  let subtype: string | null = null;
  const subtypeRaw = str(fd, "subtype_slug");
  if (subtypeRaw && itemType) {
    const allowed = valid.subtypesByItemType.get(itemType);
    if (allowed?.has(subtypeRaw)) subtype = subtypeRaw;
  }

  // F6: three submit buttons on the product form, each carrying a
  // different `intent` via <button name="intent" value="…">:
  //   - intent="draft"    → force status=draft (Save as Draft)
  //   - intent="publish"  → force status=published (Publish)
  //   - intent="save" or missing → respect whatever the Status
  //     PillGrid selected (plain Save)
  // Doing the override here means every call-site (create + update)
  // gets it for free and can't forget.
  const intent = str(fd, "intent");
  const pickedStatus =
    (pickOne(str(fd, "status"), PRODUCT_STATUSES) as ProductStatus) ?? "draft";
  const status: ProductStatus =
    intent === "draft"
      ? "draft"
      : intent === "publish"
        ? "published"
        : pickedStatus;

  return {
    name,
    brand: str(fd, "brand"),
    item_type: itemType,
    subtype_slug: subtype,
    room_slugs: pickManyFromSet(fd, "room_slugs", valid.rooms),
    styles: pickManyFromSet(fd, "styles", valid.styles),
    colors: pickManyFromSet(fd, "colors", valid.colors),
    materials: pickManyFromSet(fd, "materials", valid.materials),
    store_locations: pickManyFromSet(fd, "store_locations", valid.regions),
    dimensions_mm: parseDimensions(fd),
    weight_kg: num(fd, "weight_kg"),
    price_myr: num(fd, "price_myr"),
    price_tier: pickOne(str(fd, "price_tier"), PRICE_TIERS) as PriceTier | null,
    purchase_url: str(fd, "purchase_url"),
    supplier: str(fd, "supplier"),
    description: str(fd, "description"),
    status,
    ai_filled_fields: fd.getAll("ai_filled_fields").map((x) => x.toString()),
  };
}

function fileOrNull(fd: FormData, key: string): File | null {
  const v = fd.get(key);
  if (v instanceof File && v.size > 0) return v;
  return null;
}

/**
 * Encode a Supabase storage / generic upload error into a redirect
 * query so the form can show a real message instead of a 500 page.
 * Rethrows non-error throwables as a fallback.
 */
function uploadErrMsg(err: unknown, defaultLabel: string): string {
  if (err instanceof Error) return err.message;
  return defaultLabel;
}

/**
 * Validate a storage path the client wrote into `glb_path` before we
 * trust it into the DB. The FileDropzone mints this via signed URL,
 * but since server actions are URL-addressable we still sanity-check
 * the shape to defeat a hand-crafted POST that tries to point the
 * product at someone else's storage object.
 *
 * Expected shape: `products/<productId>/model.glb` — we derive this
 * deterministically from productId, so we just confirm the client
 * didn't try anything fancy.
 */
function validGlbPath(path: string | null, productId: string): boolean {
  if (!path) return false;
  return path === `products/${productId}/model.glb`;
}

/**
 * Insert one product_images row per staged entry at state='raw'.
 * Idempotent via upsert on id — if the client retried the save and
 * the row already exists we just refresh it.
 *
 * The raw bytes already live in Storage at
 * `<productId>/<imageId>.<ext>` (the signed URL mint used that path
 * deterministically). Here we just record their existence in the DB
 * so the rembg worker can find them.
 */
async function attachStagedRawImages(
  productId: string,
  entries: RawImageEntry[],
): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  if (entries.length === 0) return { ok: true, ids: [] };
  const supabase = createServiceRoleClient();
  const rows = entries.map((e) => ({
    id: e.imageId,
    product_id: productId,
    state: "raw" as const,
    raw_image_url: `${productId}/${e.imageId}.${e.ext}`,
  }));
  const { error } = await supabase
    .from("product_images")
    .upsert(rows, { onConflict: "id" });
  if (error) return { ok: false, error: error.message };
  return { ok: true, ids: rows.map((r) => r.id) };
}

/**
 * Run rembg AUTO for every image on `productId` that's currently
 * state='raw' or 'cutout_failed'. Called ONLY when the product ends
 * up `status='published'` after this save — draft products never
 * burn rembg quota (that's the whole "nothing commits until Publish"
 * principle).
 *
 * Sequential on purpose:
 *   - rembg is quota-metered via advisory lock in reserve_api_slot();
 *     concurrent calls serialize on that lock anyway.
 *   - Keeps the progress deterministic for the caller's telemetry
 *     (approved/failed counts used by the redirect banner).
 *
 * Returns per-run counts so the caller can encode them into the
 * redirect query for the UI banner.
 */
async function processPendingImagesForPublish(
  productId: string,
): Promise<{ approved: number; failed: number; ran: number }> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("product_images")
    .select("id")
    .eq("product_id", productId)
    .in("state", ["raw", "cutout_failed"]);
  if (error) return { approved: 0, failed: 0, ran: 0 };
  const ids = (data ?? []).map((r) => r.id);
  if (ids.length === 0) return { approved: 0, failed: 0, ran: 0 };

  // cutout_failed rows need their stale cutout artifacts cleared
  // before the worker re-runs — reset to state='raw' first so the
  // worker fetch path hits raw_image_url, not a dead cutout one.
  await supabase
    .from("product_images")
    .update({
      state: "raw",
      cutout_image_url: null,
      rembg_provider: null,
      rembg_cost_usd: null,
    })
    .in("id", ids);

  let approved = 0;
  let failed = 0;
  for (const id of ids) {
    const res = await runRembgForImage(productId, id, undefined, "auto");
    if (res.ok) approved++;
    else failed++;
  }
  return { approved, failed, ran: ids.length };
}

export async function createProduct(fd: FormData): Promise<void> {
  // /admin/products/new only ships the `name` input. parsePayload
  // returns sane defaults (empty arrays, draft status) for everything
  // else so the form-shape doesn't matter here.
  const payload = await parsePayload(fd);
  const id = crypto.randomUUID();
  const supabase = createServiceRoleClient();

  // GLB + thumbnail could come from /products/new if that form ever
  // grows them. Today it's name-only, so both paths stay null.
  //
  // Post direct-upload refactor (2026-04): `glb_path` is a STRING
  // storage path the FileDropzone wrote via a signed URL — not a File
  // blob. We validate the shape (must be `products/<id>/model.glb`)
  // and resolve its public URL here. `glb_size_kb` is a companion
  // number field the dropzone writes alongside.
  let glb_url: string | null = null;
  let glb_size_kb: number | null = null;
  let thumbnail_url: string | null = null;

  try {
    const glbPath = str(fd, "glb_path");
    if (glbPath) {
      if (!validGlbPath(glbPath, id)) {
        redirect(
          `/admin/products/new?err=upload&msg=${encodeURIComponent("invalid glb path")}`,
        );
      }
      glb_url = glbPublicUrl(id);
      glb_size_kb = num(fd, "glb_size_kb");
    }
    const thumb = fileOrNull(fd, "thumbnail_file");
    if (thumb) {
      thumbnail_url = await uploadThumbnail(id, thumb);
    }
  } catch (err) {
    redirect(
      `/admin/products/new?err=upload&msg=${encodeURIComponent(uploadErrMsg(err, "upload failed"))}`,
    );
  }

  // Same Migration 0013 trigger check as updateProduct — but
  // /products/new doesn't currently surface a room picker, so
  // new products always come in as draft. Still guard explicitly
  // in case a future form grows rooms before the guard moves.
  if (payload.status === "published" && (payload.room_slugs?.length ?? 0) === 0) {
    redirect(
      `/admin/products/new?err=publish_needs_rooms&msg=${encodeURIComponent(
        "Pick at least one room before publishing.",
      )}`,
    );
  }

  const { error } = await supabase
    .from("products")
    .insert({ id, ...payload, glb_url, glb_size_kb, thumbnail_url });
  if (error) {
    redirect(
      `/admin/products/new?err=db&msg=${encodeURIComponent(error.message)}`,
    );
  }

  // Attach any staged raw images (unlikely on /new today — that form
  // is name-only — but kept here so a future /new that grows an
  // image picker Just Works). Rows go in at state='raw'.
  const stagedEntries = parseRawImageEntries(fd);
  if (stagedEntries.length > 0) {
    const attach = await attachStagedRawImages(id, stagedEntries);
    if (!attach.ok) {
      redirect(
        `/admin/products/${id}/edit?err=db&msg=${encodeURIComponent(
          `image row insert failed: ${attach.error}`,
        )}`,
      );
    }
  }

  // Rembg runs iff the product ends up published. createProduct on /new
  // currently always lands as draft, but the check is symmetric with
  // updateProduct so the rule is enforced in one place.
  let rembgCounts = { approved: 0, failed: 0, ran: 0 };
  if (payload.status === "published") {
    rembgCounts = await processPendingImagesForPublish(id);
  }

  revalidatePath("/admin");
  revalidatePath("/");
  revalidatePath(`/product/${id}`);
  invalidatePublishedCountsCache();

  const qs = new URLSearchParams({ saved: "1", fresh: "1" });
  if (stagedEntries.length > 0) qs.set("uploaded", String(stagedEntries.length));
  if (rembgCounts.ran > 0) {
    qs.set("approved", String(rembgCounts.approved));
    qs.set("failed", String(rembgCounts.failed));
  }
  redirect(`/admin/products/${id}/edit?${qs.toString()}`);
}

export async function updateProduct(id: string, fd: FormData): Promise<void> {
  const payload = await parsePayload(fd);
  const supabase = createServiceRoleClient();

  // Friendly guard for Migration 0013's products_check_rooms_required
  // trigger: "published ⇒ room_slugs non-empty". Without this pre-check
  // the operator just gets a raw Postgres error string. Applies to
  // status transitions to `published` — draft is always allowed.
  // Repro path for caf09f7d: its item_type had no room_slug pre-0013,
  // the backfill left room_slugs empty, and hitting Save with status
  // still "published" bounced off the trigger.
  if (payload.status === "published" && (payload.room_slugs?.length ?? 0) === 0) {
    redirect(
      `/admin/products/${id}/edit?err=publish_needs_rooms&msg=${encodeURIComponent(
        "Pick at least one room before publishing. Draft is still fine with no rooms.",
      )}`,
    );
  }

  const updates: ProductUpdate = { ...payload };

  try {
    const glbPath = str(fd, "glb_path");
    if (glbPath) {
      // Same validation as createProduct — the signed-URL mint used
      // this exact path, so anything else is a crafted request.
      if (!validGlbPath(glbPath, id)) {
        redirect(
          `/admin/products/${id}/edit?err=upload&msg=${encodeURIComponent("invalid glb path")}`,
        );
      }
      updates.glb_url = glbPublicUrl(id);
      updates.glb_size_kb = num(fd, "glb_size_kb");
    }
    const thumb = fileOrNull(fd, "thumbnail_file");
    if (thumb) {
      updates.thumbnail_url = await uploadThumbnail(id, thumb);
    }
  } catch (err) {
    redirect(
      `/admin/products/${id}/edit?err=upload&msg=${encodeURIComponent(uploadErrMsg(err, "upload failed"))}`,
    );
  }

  const { error } = await supabase.from("products").update(updates).eq("id", id);
  if (error) {
    redirect(
      `/admin/products/${id}/edit?err=db&msg=${encodeURIComponent(error.message)}`,
    );
  }

  // Attach staged raw images (PUT already happened client-side via
  // signed URL). Rows go in at state='raw' — rembg only runs iff
  // the product ends up published (below).
  const stagedEntries = parseRawImageEntries(fd);
  if (stagedEntries.length > 0) {
    const attach = await attachStagedRawImages(id, stagedEntries);
    if (!attach.ok) {
      redirect(
        `/admin/products/${id}/edit?err=db&msg=${encodeURIComponent(
          `image row insert failed: ${attach.error}`,
        )}`,
      );
    }
  }

  // The core of the "commit on Save" rule:
  //   - Save-as-Draft (intent=draft) → status=draft → skip rembg.
  //   - Save (intent=save) → respects PillGrid; if user left it on
  //     'published' the product stays published → rembg runs on
  //     any raw / cutout_failed rows. This is the "operator edited
  //     a published product, added a new photo, clicked Save" case
  //     Jym flagged in test 3.
  //   - Publish (intent=publish) → status=published → rembg runs.
  // We key off the *final* payload.status so the single rule covers
  // all three intents without branching on intent name.
  let rembgCounts = { approved: 0, failed: 0, ran: 0 };
  if (payload.status === "published") {
    rembgCounts = await processPendingImagesForPublish(id);
  }

  revalidatePath("/admin");
  revalidatePath("/");
  revalidatePath(`/product/${id}`);
  invalidatePublishedCountsCache();

  const qs = new URLSearchParams({ saved: "1" });
  if (stagedEntries.length > 0) qs.set("uploaded", String(stagedEntries.length));
  if (rembgCounts.ran > 0) {
    qs.set("approved", String(rembgCounts.approved));
    qs.set("failed", String(rembgCounts.failed));
  }
  redirect(`/admin/products/${id}/edit?${qs.toString()}`);
}

export async function deleteProduct(id: string): Promise<void> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/admin");
  revalidatePath("/");
  invalidatePublishedCountsCache();
  redirect("/admin?deleted=1");
}

// ─── Inline-edit actions used by the /admin table ──────────────
//
// Each takes (id, value) and writes a single column. We don't reuse
// `updateProduct` because it parses the entire payload — these are
// invoked from per-cell forms that only carry one value, and parsing
// "missing" fields as null would clobber unrelated columns.

export async function setProductStatusAction(fd: FormData): Promise<void> {
  const id = str(fd, "id");
  const next = pickOne(str(fd, "status"), PRODUCT_STATUSES) as
    | ProductStatus
    | null;
  if (!id || !next) return;
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("products")
    .update({ status: next })
    .eq("id", id);
  if (error) {
    redirect(
      `/admin?err=status&msg=${encodeURIComponent(error.message)}`,
    );
  }
  revalidatePath("/admin");
  revalidatePath("/");
  revalidatePath(`/product/${id}`);
  invalidatePublishedCountsCache();
  redirect("/admin");
}

export async function setProductPriceAction(fd: FormData): Promise<void> {
  const id = str(fd, "id");
  if (!id) return;
  const raw = str(fd, "price_myr");
  // Empty input ⇒ clear the price. Number input is browser-validated
  // but we re-parse here defensively.
  const price = raw == null ? null : Number(raw);
  if (raw != null && !Number.isFinite(price)) {
    redirect(`/admin?err=price&msg=invalid+number`);
  }
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("products")
    .update({ price_myr: price as number | null })
    .eq("id", id);
  if (error) {
    redirect(`/admin?err=price&msg=${encodeURIComponent(error.message)}`);
  }
  revalidatePath("/admin");
  revalidatePath(`/product/${id}`);
  redirect("/admin");
}

export async function setProductItemTypeAction(fd: FormData): Promise<void> {
  const id = str(fd, "id");
  const slug = str(fd, "item_type");
  if (!id) return;
  const valid = await loadValidSlugs();
  const itemType = slug && valid.itemTypes.has(slug) ? slug : null;
  const supabase = createServiceRoleClient();
  // Changing item_type clears subtype — old subtype almost certainly
  // doesn't belong to the new item_type, and the DB trigger would
  // reject the update otherwise.
  const { error } = await supabase
    .from("products")
    .update({ item_type: itemType, subtype_slug: null })
    .eq("id", id);
  if (error) {
    redirect(`/admin?err=item_type&msg=${encodeURIComponent(error.message)}`);
  }
  revalidatePath("/admin");
  revalidatePath("/");
  revalidatePath(`/product/${id}`);
  invalidatePublishedCountsCache();
  redirect("/admin");
}

// ─── Bulk operations ─────────────────────────────────────────────

export async function bulkUpdateStatusAction(fd: FormData): Promise<void> {
  const ids = fd.getAll("ids").map((x) => x.toString()).filter(Boolean);
  const next = pickOne(str(fd, "status"), PRODUCT_STATUSES) as
    | ProductStatus
    | null;
  if (!ids.length || !next) {
    redirect("/admin");
  }
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("products")
    .update({ status: next })
    .in("id", ids);
  if (error) {
    redirect(`/admin?err=bulk&msg=${encodeURIComponent(error.message)}`);
  }
  revalidatePath("/admin");
  revalidatePath("/");
  invalidatePublishedCountsCache();
  redirect(`/admin?bulk=${ids.length}&status=${next}`);
}

export async function bulkDeleteAction(fd: FormData): Promise<void> {
  const ids = fd.getAll("ids").map((x) => x.toString()).filter(Boolean);
  if (!ids.length) redirect("/admin");
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("products").delete().in("id", ids);
  if (error) {
    redirect(`/admin?err=bulk_delete&msg=${encodeURIComponent(error.message)}`);
  }
  revalidatePath("/admin");
  revalidatePath("/");
  invalidatePublishedCountsCache();
  redirect(`/admin?bulk_deleted=${ids.length}`);
}

export async function runAiInfer(fd: FormData): Promise<{
  suggestedFields: Record<string, unknown>;
  inferredKeys: string[];
  note?: string;
}> {
  const result = await inferProductFields({
    name: str(fd, "name") ?? undefined,
    description: str(fd, "description") ?? undefined,
    brand: str(fd, "brand"),
  });
  return {
    suggestedFields: result.fields as Record<string, unknown>,
    inferredKeys: result.inferredKeys,
    note: result.note,
  };
}
