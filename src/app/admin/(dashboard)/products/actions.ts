"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  glbPublicUrl,
  uploadThumbnail,
  getSignedRawUrl,
  thumbnailPublicUrl,
} from "@/lib/storage";
import { inferProductFields } from "@/lib/ai/infer";
import { requireAdmin } from "@/lib/auth/require-admin";
import { invalidatePublishedCountsCache } from "@/lib/products";
import { runRembgForImage } from "@/lib/rembg/pipeline";
import { kickOffMeshyForProduct } from "@/lib/meshy-kickoff";
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
    // De-dup: ProductForm re-emits the persisted list from the
    // product row AND AIInferButton adds a fresh set after each run,
    // so the same key can arrive twice. A Set keeps the column clean.
    ai_filled_fields: [
      ...new Set(fd.getAll("ai_filled_fields").map((x) => x.toString())),
    ],
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

  // Manual-upload provenance (mirrors updateProduct). createProduct
  // doesn't currently kick off Meshy (the /new form has no images
  // attached, kickOff would just fail no_cutouts) — but if the form
  // ever grows a GLB upload, the provenance fields keep the "Meshy
  // only runs once" gate honest.
  let glb_source: "manual_upload" | null = null;
  let glb_generated_at: string | null = null;

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
      glb_source = "manual_upload";
      glb_generated_at = new Date().toISOString();
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
    .insert({
      id,
      ...payload,
      glb_url,
      glb_size_kb,
      thumbnail_url,
      glb_source,
      glb_generated_at,
    });
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
  // intent is what the operator pressed (draft / publish / save).
  // parsePayload already rolled it into payload.status, but Meshy
  // kick-off branches need to distinguish "press Publish" from
  // "save with status pre-set to published" — only the former
  // should invoke Meshy.
  const intent = str(fd, "intent");

  // Friendly guard for Migration 0013's products_check_rooms_required
  // trigger: "published ⇒ room_slugs non-empty". Without this pre-check
  // the operator just gets a raw Postgres error string. Applies to
  // status transitions to `published` — draft is always allowed.
  // Repro path for caf09f7d: its item_type had no room_slug pre-0013,
  // the backfill left room_slugs empty, and hitting Save with status
  // still "published" bounced off the trigger.
  // Note: even when we're about to held-back to draft for a Meshy
  // run (below), the operator's *intent* is publish, so we still
  // require rooms. Forces the operator to pick rooms at Publish click.
  if (payload.status === "published" && (payload.room_slugs?.length ?? 0) === 0) {
    redirect(
      `/admin/products/${id}/edit?err=publish_needs_rooms&msg=${encodeURIComponent(
        "Pick at least one room before publishing. Draft is still fine with no rooms.",
      )}`,
    );
  }

  // ── M3 held-back-status pattern (no GLB, no publish — 铁律) ─────
  //
  // When the operator clicks Publish on a product that has no GLB
  // (neither uploaded in this request nor pre-existing), we DON'T
  // let it land at status='published'. Instead:
  //   1. Override status → 'draft' for this save.
  //   2. Save the row + run rembg + attach staged images normally.
  //   3. Kick off Meshy. The polling worker (Commit 5) flips status
  //      to 'published' when the GLB lands.
  //
  // The branch fires only when ALL of:
  //   - intent='publish'                      (operator pressed Publish)
  //   - no glb_path uploaded this request     (manual upload would
  //                                            satisfy "has GLB" already)
  //   - existing row has no glb_url           (Meshy never overwrites
  //                                            a successful GLB; that's
  //                                            the "Meshy only runs once"
  //                                            rule)
  //
  // The "manual GLB this request" check comes from validating glb_path
  // again later in the upload block — we pre-compute it here so the
  // branch decision happens before any DB write.
  const glbPathInRequest = str(fd, "glb_path");
  const { data: existingForGlb } = await supabase
    .from("products")
    .select("glb_url")
    .eq("id", id)
    .maybeSingle();
  const hasManualGlbThisRequest = Boolean(glbPathInRequest);
  const hasExistingGlb = Boolean(existingForGlb?.glb_url);
  const willKickOffMeshy =
    intent === "publish" && !hasManualGlbThisRequest && !hasExistingGlb;

  const updates: ProductUpdate = { ...payload };
  if (willKickOffMeshy) {
    // Held-back: row stays at draft until polling worker promotes it.
    // payload.status was 'published' (from intent=publish); override.
    updates.status = "draft";
  }

  try {
    if (glbPathInRequest) {
      // Same validation as createProduct — the signed-URL mint used
      // this exact path, so anything else is a crafted request.
      if (!validGlbPath(glbPathInRequest, id)) {
        redirect(
          `/admin/products/${id}/edit?err=upload&msg=${encodeURIComponent("invalid glb path")}`,
        );
      }
      updates.glb_url = glbPublicUrl(id);
      updates.glb_size_kb = num(fd, "glb_size_kb");
      // Manual upload → mark provenance + generated time so the
      // "Meshy only runs once" gate trips correctly even if the
      // operator clears glb_url and re-Publishes later.
      updates.glb_source = "manual_upload";
      updates.glb_generated_at = new Date().toISOString();
      // Manual upload IS the GLB — no Meshy run, no generating
      // status. If the row had a stale failed Meshy state from a
      // prior attempt, leave it alone (audit trail) rather than
      // wipe it; admin can read the history.
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
  // the product ends up published OR we're about to kick off Meshy
  // (Meshy needs cutouts, so we have to run rembg first even though
  // the row will sit at draft).
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
  //   - Publish (intent=publish) → status=published OR (held-back
  //     to draft for Meshy) → rembg runs in BOTH cases. The
  //     held-back path needs cutouts ready before Meshy can fetch
  //     them.
  // We key off `payload.status === 'published' || willKickOffMeshy`
  // — both branches require fresh cutouts.
  let rembgCounts = { approved: 0, failed: 0, ran: 0 };
  if (payload.status === "published" || willKickOffMeshy) {
    rembgCounts = await processPendingImagesForPublish(id);
  }

  // Held-back Meshy kick-off. Runs AFTER rembg so cutouts are ready.
  // Does its own DB write to stamp meshy_task_id / status='generating'.
  let meshyKick: Awaited<ReturnType<typeof kickOffMeshyForProduct>> | null =
    null;
  if (willKickOffMeshy) {
    meshyKick = await kickOffMeshyForProduct(id);
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
  if (meshyKick) {
    if (meshyKick.ok) {
      // Banner reads `meshy=started` — Commit 2's UI work shows
      // "3D 生成中..." until the polling worker flips status.
      qs.set("meshy", "started");
    } else {
      qs.set("err", `meshy_${meshyKick.error}`);
      if (meshyKick.detail) qs.set("msg", meshyKick.detail);
    }
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

/**
 * Vision-backed autofill. Invoked by the "AI autofill" button on
 * /admin/products/[id]/edit.
 *
 * Flow:
 *   1. Admin-gate the call (server actions are URL-addressable).
 *   2. Look up up to MAX_IMAGES rows from product_images, preferring
 *      raw (signed URL against private bucket — JPGs are small enough
 *      that OpenAI's fetcher doesn't time out) with cutout as a
 *      fallback for legacy rows missing a raw_image_url. See the
 *      in-body comment for the cutout-first regression history.
 *   3. Hand the URLs to inferProductFields() which asks GPT-4o to
 *      classify against the live taxonomy enums.
 *   4. Return a slim, JSON-serializable shape so the client can fan
 *      the picks out to pickers via the autofill-bus CustomEvent.
 *
 * No revalidatePath() here — nothing is written to DB until the
 * operator clicks Save and the regular updateProduct path runs.
 * The AI-filled bits get persisted into ai_filled_fields at that
 * point (hidden inputs already handle that via ProductForm).
 */
const AI_MAX_IMAGES = 3;

export type RunAiInferResult = {
  ok: true;
  fields: Record<string, unknown>;
  inferredKeys: string[];
  confidence: Partial<Record<string, number>>;
  model: string;
  note?: string;
  debug: {
    latency_ms: number;
    imageCount: number;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };
} | {
  ok: false;
  error: string;
};

export async function runAiInfer(
  productId: string | null,
): Promise<RunAiInferResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: "Not signed in." };
  }

  if (!productId || productId.length < 10) {
    return { ok: false, error: "Save the product first, then attach an image before running AI autofill." };
  }

  const supabase = createServiceRoleClient();
  const { data: images, error: imgErr } = await supabase
    .from("product_images")
    .select("id, raw_image_url, cutout_image_url, state, created_at")
    .eq("product_id", productId)
    .order("created_at", { ascending: true })
    .limit(AI_MAX_IMAGES);
  if (imgErr) {
    return { ok: false, error: `Failed to load product images: ${imgErr.message}` };
  }
  if (!images || images.length === 0) {
    return { ok: false, error: "Upload at least one product photo before running AI autofill." };
  }

  // Resolve fetchable URLs. IMPORTANT: prefer RAW over CUTOUT.
  //
  // Why not cutouts? They're rembg PNGs with alpha — lossless and
  // often 5-10× larger than the source JPG (measured: 6.56MB PNG
  // vs 1.45MB JPG for the same shot). OpenAI's Vision fetcher has
  // a short per-URL timeout, and Supabase Storage in ap-southeast-1
  // regularly missed it on the 6.56MB payloads we first tried —
  // every call came back `400 Timeout while downloading …`. The
  // raw JPG is well under that ceiling and GPT-4o has no trouble
  // classifying through background (faucets on counters, chairs
  // in rooms) — cutouts were a "nice to have" for cleanliness,
  // not a correctness requirement.
  //
  // Raw lives in the private bucket, so we mint a 1h signed URL.
  // Cutout stays as a fallback for legacy rows that somehow lost
  // their raw_image_url.
  const imageUrls: string[] = [];
  for (const img of images) {
    if (img.raw_image_url) {
      try {
        const signed = await getSignedRawUrl(img.raw_image_url);
        imageUrls.push(signed);
        continue;
      } catch (err) {
        // Fall through to cutout fallback — the row may have a
        // still-fetchable cutout even if the raw is gone.
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[runAiInfer] signed URL failed for ${img.raw_image_url}: ${msg}`);
      }
    }
    if (img.cutout_image_url) {
      imageUrls.push(img.cutout_image_url);
    }
  }

  if (imageUrls.length === 0) {
    return { ok: false, error: "No fetchable image URLs could be built for this product." };
  }

  const result = await inferProductFields({ imageUrls });

  return {
    ok: true,
    fields: result.fields as Record<string, unknown>,
    inferredKeys: result.inferredKeys,
    confidence: result.confidence,
    model: result.model,
    note: result.note,
    debug: {
      latency_ms: result.debug.latency_ms,
      imageCount: imageUrls.length,
      usage: result.debug.usage,
    },
  };
}

/**
 * Finalize an inline thumbnail swap. The browser already PUT the bytes
 * direct to Storage via a signed URL minted by `getSignedUploadUrl`;
 * this action just reconstructs the public URL (with cache-bust),
 * writes it to `products.thumbnail_url`, and revalidates the surfaces
 * that show product cards.
 *
 * Why a thin "post-upload commit" action instead of carrying the URL
 * back in the upload-actions response: the browser's PUT happens
 * outside our server function entirely, so there has to be a second
 * round-trip *anyway* to mark the DB. Splitting it like this also lets
 * the client retry just the DB write (a transient Postgres failure
 * doesn't force a re-upload of the bytes).
 *
 * Cache-bust: THUMBS_BUCKET is public + cache-controlled to 1 year.
 * Without `?v=<timestamp>` an upserted file would keep returning the
 * old bytes from CDN/browser caches for hours-to-days. Same trick
 * uploadCutout already uses on cutouts URLs.
 *
 * Validation: ext must be one of ALLOWED_IMAGE_EXTS (also enforced by
 * upload-actions before minting the URL), productId must be UUID-shaped.
 * Returns a JSON outcome — caller (ThumbnailSwapButton) shows inline
 * red-border + tooltip on failure rather than a redirect.
 */
export async function setProductThumbnail(
  productId: string,
  ext: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  await requireAdmin();

  if (!UUID_RE.test(productId)) {
    return { ok: false, error: "invalid product id" };
  }
  const normalizedExt = ext.toLowerCase().replace(/^\./, "");
  if (!ALLOWED_IMAGE_EXTS.has(normalizedExt)) {
    return { ok: false, error: `unsupported image extension (${ext})` };
  }

  const baseUrl = thumbnailPublicUrl(productId, normalizedExt);
  const url = `${baseUrl}?v=${Date.now()}`;

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("products")
    .update({ thumbnail_url: url })
    .eq("id", productId);
  if (error) {
    return { ok: false, error: error.message };
  }

  // Surfaces that render product cards: admin list, public homepage,
  // public detail page, and the per-product edit page (the GLB-side
  // preview also uses thumbnail_url).
  revalidatePath("/admin");
  revalidatePath("/");
  revalidatePath(`/admin/products/${productId}/edit`);
  revalidatePath(`/product/${productId}`);
  invalidatePublishedCountsCache();

  return { ok: true, url };
}

// ─── M3 · Commit 2: client-side soft polling ───────────────────
//
// Read-only "what's the Meshy job up to" probe. The Edit page's
// MeshyStatusBanner client component calls this every 5s while the
// status is 'generating' so the operator sees the banner flip to
// green ("Live now") or red ("failed") without a page refresh.
//
// Why a server action and not an API route:
//   - Same admin auth gate as the rest of the page (requireAdmin()
//     uses cookies); an /api route would need its own gate.
//   - Server actions return JSON-serializable values directly to the
//     client component — no fetch/JSON.parse boilerplate.
//
// What it deliberately DOESN'T do:
//   - Call Meshy. The polling worker (Commit 5, server-side cron)
//     owns the Meshy GET + GLB download. This action just reads our
//     own DB row, so it costs nothing and stays fast even at 5s
//     cadence.
//   - Mutate. It's a pure read — no rate limiting needed, no CSRF
//     concerns beyond what the server action runtime already gives.
//
// Returned shape includes everything the banner needs to render
// without a follow-up roundtrip:
//   - status: the 4-value enum (or null if never went through Meshy)
//   - error:  meshy_error text for the red-banner detail
//   - glbUrl: when status='succeeded', the banner shows "Refresh"
//             so the operator sees the GLB on the form. The URL
//             itself isn't displayed; presence is just a sanity
//             check that the worker actually wrote it.
//   - productStatus: for cross-checking — when meshy succeeds the
//             worker promotes the row to 'published'. The banner
//             can use this to say "published & live" vs. just
//             "GLB ready".

export type MeshyStatusSnapshot = {
  status: "pending" | "generating" | "succeeded" | "failed" | null;
  error: string | null;
  glbUrl: string | null;
  productStatus: ProductStatus;
  attempts: number;
};

export async function getMeshyStatus(
  productId: string,
): Promise<{ ok: true; snapshot: MeshyStatusSnapshot } | { ok: false; error: string }> {
  // Admin gate — even though this only reads, we don't want
  // unauthenticated callers polling the table.
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: "Not signed in." };
  }

  if (!UUID_RE.test(productId)) {
    return { ok: false, error: "invalid product id" };
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("products")
    .select("meshy_status, meshy_error, meshy_attempts, glb_url, status")
    .eq("id", productId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "product not found" };

  return {
    ok: true,
    snapshot: {
      status: data.meshy_status,
      error: data.meshy_error,
      glbUrl: data.glb_url,
      productStatus: data.status,
      attempts: data.meshy_attempts,
    },
  };
}
