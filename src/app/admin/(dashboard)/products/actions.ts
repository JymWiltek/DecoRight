"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  glbPublicUrl,
  fbxPublicUrl,
  uploadThumbnail,
  getSignedRawUrl,
  thumbnailPublicUrl,
  copyRawToCutouts,
} from "@/lib/storage";
import { dispatchGlbCompression } from "@/lib/glb-compression-dispatch";
import { dispatchFbxBundle } from "@/lib/fbx-bundle-dispatch";
import { inferProductFields } from "@/lib/ai/infer";
import {
  parseSpecSheet,
  parseImagesMerged,
  parseImagesMergedV2,
  sanitizeV2Slugs,
  MERGED_PARSE_MAX_IMAGES,
  type SpecSheetParse,
  type SpecSheetParseV2,
  type TaxonomyHints,
  type Confidence,
} from "@/lib/ai/parse-spec";
import { requireAdmin } from "@/lib/auth/require-admin";
import { invalidatePublishedCountsCache } from "@/lib/products";
import { runRembgForImage } from "@/lib/rembg/pipeline";
import {
  checkPublishGates,
  type PublishGateInput,
  type PublishGateReason,
} from "@/lib/publish-gates";
// Wave 2B · Commit 7 retired the held-back-status pattern: updateProduct
// no longer auto-kicks Meshy as a side effect of Publish. The kickoff
// helper is still imported because `generate3DForProduct` (the explicit
// operator-driven button surface from Wave 2A · Commit 6) lives in this
// file and wraps it.
import { kickOffMeshyForProduct } from "@/lib/meshy-kickoff";
import { retryMeshyForProductCore } from "@/lib/meshy-retry";
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
  return parseImageEntriesField(fd, "raw_image_entries");
}

/** Wave 4: same JSON-array shape as `raw_image_entries`, different
 *  FormData key. UploadDropzone with kind="real_photo" emits this. */
function parseRealPhotoEntries(fd: FormData): RawImageEntry[] {
  return parseImageEntriesField(fd, "real_photo_entries");
}

function parseImageEntriesField(fd: FormData, key: string): RawImageEntry[] {
  const raw = fd.get(key);
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
    sku_id: str(fd, "sku_id"),
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
 * Wave 9 — FBX path validation. Same shape as validGlbPath; one FBX
 * per product at a fixed `products/<id>/model.fbx` path. The signed
 * upload URL mint enforces this in createSignedFbxUploadUrl, so any
 * other shape arriving here is a crafted request.
 */
function validFbxPath(path: string | null, productId: string): boolean {
  if (!path) return false;
  return path === `products/${productId}/model.fbx`;
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
/** Mig 0038 / Wave 5 — flat image-pool cap. Per-product hard limit;
 *  the AI / gallery / unify flows assume small image counts and the
 *  storefront-page render becomes noisy past this point. */
const MAX_IMAGES_PER_PRODUCT = 5;

async function attachStagedRawImages(
  productId: string,
  entries: RawImageEntry[],
): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  if (entries.length === 0) return { ok: true, ids: [] };
  const supabase = createServiceRoleClient();

  // Mig 0038 — enforce 5-image cap. Count existing non-rejected rows
  // for this product (rejected/user-rejected don't count toward cap;
  // they're audit history). The cap excludes rows that the upsert
  // is about to OVERWRITE — if the operator retries with the same
  // imageId, we shouldn't double-count.
  const incomingIds = new Set(entries.map((e) => e.imageId));
  const { data: existing } = await supabase
    .from("product_images")
    .select("id, state")
    .eq("product_id", productId)
    .not("state", "in", "(cutout_rejected,user_rejected)");
  const existingNotOverwritten = (existing ?? []).filter(
    (r) => !incomingIds.has(r.id),
  ).length;
  if (existingNotOverwritten + entries.length > MAX_IMAGES_PER_PRODUCT) {
    return {
      ok: false,
      error: `image cap: a product can have at most ${MAX_IMAGES_PER_PRODUCT} active images. Delete an existing image before adding more.`,
    };
  }

  // Wave 11b — DEFAULT = use the raw photo as-is (no rembg).
  //
  // Jym switched the catalog to Wiltek's own rendered scene photos
  // and does NOT want the pipeline auto-removing backgrounds (it
  // destroys those renders). So new uploads land exactly like a
  // "Skip — already clean" click (mig 0027): raw bytes copied into
  // the public cutouts bucket, row at cutout_approved + skip_cutout,
  // which makes the card + storefront + publish gate all work
  // WITHOUT touching the original. The operator opts INTO background
  // removal per-image via the "Remove Background" button (which
  // resets the row to raw and runs rembg).
  //
  // We assign is_primary to the first uploaded image iff the product
  // has no primary yet — mirrors runRembgForImage / markImageSkipCutout
  // AUTO-mode convention. The BEFORE-INSERT auto_set_primary_thumbnail
  // trigger (mig 0038) then sets is_primary_thumbnail=true on it.
  const { data: existingPrimary } = await supabase
    .from("product_images")
    .select("id")
    .eq("product_id", productId)
    .eq("is_primary", true)
    .maybeSingle();
  let primaryAssigned = !!existingPrimary;

  // Wave 11b — thumbnail_url is now ONLY written by the unify route
  // (mig 0037 dropped the legacy sync trigger; the unify trigger fires
  // on UPDATE state-transitions, NOT on the direct INSERT we do here).
  // So when one of these uploads becomes the product's primary we must
  // point products.thumbnail_url at its raw public copy ourselves —
  // otherwise the storefront card renders the "3D · AR" placeholder
  // until someone clicks "Unify Center". This is the raw-as-is default
  // ("否则 → 显示原图"); a later Unify Center overwrites it with the
  // unified PNG ("如果有 unified → 显示 unified").
  let newPrimaryThumbUrl: string | null = null;

  const ids: string[] = [];
  for (const e of entries) {
    const rawPath = `${productId}/${e.imageId}.${e.ext}`;
    // Copy raw → public cutouts bucket so the card/thumbnail resolve
    // to a public CDN URL (a private raw path wouldn't render).
    let publicUrl: string;
    try {
      publicUrl = await copyRawToCutouts(rawPath, productId, e.imageId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `copy ${e.imageId}: ${msg}` };
    }
    const row: {
      id: string;
      product_id: string;
      state: "cutout_approved";
      raw_image_url: string;
      cutout_image_url: string;
      image_kind: "cutout";
      skip_cutout: true;
      is_primary?: boolean;
    } = {
      id: e.imageId,
      product_id: productId,
      state: "cutout_approved",
      raw_image_url: rawPath,
      cutout_image_url: publicUrl,
      image_kind: "cutout",
      skip_cutout: true,
    };
    if (!primaryAssigned) {
      row.is_primary = true;
      primaryAssigned = true;
      newPrimaryThumbUrl = publicUrl;
    }
    const { error } = await supabase
      .from("product_images")
      .upsert(row, { onConflict: "id" });
    if (error) return { ok: false, error: error.message };
    ids.push(e.imageId);
  }

  // Point the card at the raw copy if one of these uploads just became
  // the primary. Guarded on newPrimaryThumbUrl so adding non-primary
  // images to a product that already has a (possibly unified)
  // thumbnail never stomps it.
  if (newPrimaryThumbUrl) {
    const { error: thumbErr } = await supabase
      .from("products")
      .update({ thumbnail_url: newPrimaryThumbUrl })
      .eq("id", productId);
    if (thumbErr) return { ok: false, error: thumbErr.message };
  }

  return { ok: true, ids };
}

/**
 * Wave 4 — insert one product_images row per staged real-photo entry.
 *
 * Differences vs. attachStagedRawImages:
 *   • image_kind = 'real_photo' so the rembg processing scan
 *     (processPendingImagesForPublish) skips these rows entirely.
 *   • state = 'cutout_approved' lands the row at a terminal state
 *     immediately — no admin-review queue, no rembg quota burn,
 *     and the storefront SELECT (which filters cutout_approved)
 *     surfaces them right away.
 *   • cutout_image_url mirrors raw_image_url so any future code
 *     path that prefers the cutout column still resolves to a
 *     real URL. The storefront real-photo strip reads raw_image_url
 *     directly so this dual-population is belt-and-braces.
 *   • is_primary stays default false — real photos never drive the
 *     thumbnail. The product's unified thumbnail (Wave 2) comes
 *     from the cutout pipeline.
 *
 * Idempotent via upsert on id like the cutout path, so a client
 * retry doesn't double-insert.
 */
async function attachStagedRealPhotos(
  productId: string,
  entries: RawImageEntry[],
): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  if (entries.length === 0) return { ok: true, ids: [] };
  const supabase = createServiceRoleClient();
  const rows = entries.map((e) => {
    const path = `${productId}/${e.imageId}.${e.ext}`;
    return {
      id: e.imageId,
      product_id: productId,
      state: "cutout_approved" as const,
      raw_image_url: path,
      cutout_image_url: path,
      image_kind: "real_photo" as const,
      is_primary: false,
    };
  });
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
  // Mig 0034 — image_kind filter prevents real_photo / spec_sheet
  // rows from accidentally being run through rembg. Real photos
  // also land at state='cutout_approved' so the state filter
  // already excludes them; spec_sheets get inserted similarly when
  // Wave 3 ships. The image_kind clause is belt-and-braces.
  const { data, error } = await supabase
    .from("product_images")
    .select("id")
    .eq("product_id", productId)
    .eq("image_kind", "cutout")
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
      // Clear stale failure tag from a previous Publish attempt; the
      // worker will re-tag if this run also fails. Without this the
      // UI would carry forward an obsolete "no_provider" sentence
      // even after the env var is fixed and the retry succeeds.
      last_error_kind: null,
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

// ─── Wave 2A · Commit 5: standalone "Run Background Removal" ───
//
// Publish flow γ-redesign moves rembg out from "buried under
// Save/Publish auto-trigger" to "explicit button the operator
// clicks when they want to spend rembg quota". This action is the
// thin admin wrapper around the existing processPendingImagesForPublish
// helper so the button on ProductImagesSection can fire it without
// going through updateProduct.
//
// Why a separate action instead of reusing setProductStatusAction +
// publish logic: the operator may want to run rembg on draft rows
// before they've decided to publish (Q: "how does the cutout look?
// good enough to use for Meshy / store-front?"). Forcing them
// through Publish to get cutouts breaks that exploration flow.
//
// Returns plain JSON instead of redirecting because the calling
// component (RunRembgButton) wants to render the count in a banner
// without a full page reload — there's a separate router.refresh()
// after success to pick up the new image rows.
export type RunRembgResult =
  | { ok: true; approved: number; failed: number; ran: number }
  | { ok: false; error: string };

export async function runRembgForProduct(
  productId: string,
): Promise<RunRembgResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: "Not signed in." };
  }
  if (!UUID_RE.test(productId)) {
    return { ok: false, error: "invalid product id" };
  }

  // Reuse the same helper updateProduct calls on Publish — no need
  // to duplicate the "reset cutout_failed → raw, then loop, accrue
  // approved/failed counts" logic. processPendingImagesForPublish
  // is already idempotent (operates on raw + cutout_failed only).
  const counts = await processPendingImagesForPublish(productId);

  // Revalidate so the next render sees the fresh image rows. The
  // banner does its own router.refresh() too, but this ensures cache
  // entries on adjacent surfaces (admin list thumbnail) catch up.
  revalidatePath(`/admin/products/${productId}/edit`);
  revalidatePath("/admin");

  return { ok: true, ...counts };
}

// Read-only counter that the progress banner polls every 5s while
// the action is running. Cheaper than the action's own return — it
// just counts rows by state. The banner uses
//   total = raw + cutout_failed + cutout_approved + cutout_pending
// at the moment the run started; remaining = raw + cutout_failed.
// done = total - remaining.
export type RembgProgressSnapshot = {
  raw: number;
  cutout_failed: number;
  cutout_approved: number;
  cutout_pending: number;
};

export async function getRembgProgress(
  productId: string,
): Promise<{ ok: true; snapshot: RembgProgressSnapshot } | { ok: false; error: string }> {
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
    .from("product_images")
    .select("state")
    .eq("product_id", productId);
  if (error) return { ok: false, error: error.message };
  const snap: RembgProgressSnapshot = {
    raw: 0,
    cutout_failed: 0,
    cutout_approved: 0,
    cutout_pending: 0,
  };
  for (const row of data ?? []) {
    if (row.state === "raw") snap.raw++;
    else if (row.state === "cutout_failed") snap.cutout_failed++;
    else if (row.state === "cutout_approved") snap.cutout_approved++;
    else if (row.state === "cutout_pending") snap.cutout_pending++;
  }
  return { ok: true, snapshot: snap };
}

// Publish gate logic moved to src/lib/publish-gates.ts — sync exports
// aren't allowed in "use server" files under Turbopack. Imported above.

/**
 * Read the three gate-relevant facts for a product in one round-trip
 * pair (parallel queries). Pure read — safe to call from any caller.
 *
 * Callers that have FRESH values from the current request (e.g.
 * updateProduct knows the form's room_slugs and any just-uploaded
 * glb_url) should override those fields when constructing the
 * checkPublishGates input — DB values may be stale within the same
 * server action.
 */
async function loadPublishGateFacts(
  productId: string,
): Promise<PublishGateInput> {
  const supabase = createServiceRoleClient();
  const [rowRes, cutCountRes] = await Promise.all([
    supabase
      .from("products")
      .select("room_slugs, glb_url")
      .eq("id", productId)
      .maybeSingle(),
    supabase
      .from("product_images")
      .select("id", { count: "exact", head: true })
      .eq("product_id", productId)
      .eq("state", "cutout_approved")
      // Wave 7 fix-2 — only product-photo cutouts satisfy gate 2.
      // image_kind='real_photo' rows (Wave 4 "skip rembg" pattern,
      // now also used for Wave-7 Reference uploads) land at
      // 'cutout_approved' immediately and would otherwise let an
      // all-reference draft auto-publish without a storefront image.
      .eq("image_kind", "cutout"),
  ]);
  return {
    rooms: rowRes.data?.room_slugs ?? [],
    glbUrl: rowRes.data?.glb_url ?? null,
    cutoutApprovedCount: cutCountRes.count ?? 0,
  };
}

// `createProduct` removed in Phase 1 收尾 P0 #4 (commit 2). The
// /admin/products/new flow no longer POSTs a name-only form here —
// it's a Server Component that inserts an "Untitled product" draft
// inline and redirects to /edit. Drafts mature into full products
// via updateProduct (below). Keep that single mutation surface.

export async function updateProduct(id: string, fd: FormData): Promise<void> {
  const payload = await parsePayload(fd);
  const supabase = createServiceRoleClient();

  // ── Wave 2B · Commit 7: strict updateProduct ─────────────────
  //
  //   What changed (vs. Wave 2A): the entire "save kicks off the
  //   pipeline" coupling is gone. updateProduct now:
  //
  //     - DOES NOT run rembg as a side effect of Save / Publish.
  //       (Operator clicks "Run Background Removal" — the standalone
  //       button from Commit 5 — when they want to spend rembg quota.)
  //     - DOES NOT kick off Meshy as a side effect of Publish.
  //       (Operator clicks "Generate 3D" — Commit 6 — when ready to
  //       spend Meshy budget.)
  //     - DOES NOT held-back-stash status='draft' to wait for Meshy.
  //       (Held-back-status pattern is retired; no GLB → no Publish.)
  //     - ENFORCES three Publish gates (rooms · cutouts · GLB) on
  //       any save that ends at status='published', regardless of
  //       which submit button the operator pressed (Bug A fix —
  //       Save with PillGrid='Published' was previously a back door
  //       around the Publish-only rooms gate and didn't gate cutouts
  //       or GLB at all).
  //
  //   Why: the legacy auto-pipeline conflated "save the row I edited"
  //   with "spend money on rembg and Meshy and surface the result
  //   when ready". Operators couldn't preview cutouts before paying,
  //   couldn't separate copy edits from regeneration, and Bug A let
  //   GLB-less rows go live whenever the PillGrid happened to be
  //   on Published at Save time. Splitting the three operations into
  //   three explicit buttons (Run BG Removal / Generate 3D / Publish)
  //   each with their own gates makes the cost and effect visible.
  //
  //   What still happens here:
  //     - Manual GLB upload (operator dropped a .glb in the dropzone)
  //     - Thumbnail upload
  //     - Form parse + validate + UPDATE products
  //     - Attach staged raw image rows (no rembg run)

  // ── Manual GLB upload (validate path, set fields) ────────────
  const glbPathInRequest = str(fd, "glb_path");
  const updates: ProductUpdate = { ...payload };
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
      // Decoded-budget metadata (mig 0031). Computed in the dropzone
      // by lib/admin/glb-budget#checkGlbBudget at pick time, shipped
      // as 3 hidden form fields. The server-side render gate
      // (lib/glb-display#glbUrlForGallery) reads these to decide
      // whether <model-viewer> should mount on the product page —
      // preventing iOS Safari OOM on borderline-too-heavy GLBs.
      // num() returns null on missing/invalid input → the DB columns
      // accept null and the gate treats null as "render anyway"
      // (backward compat with pre-mig-0031 products).
      updates.glb_vertex_count = num(fd, "glb_vertex_count");
      updates.glb_max_texture_dim = num(fd, "glb_max_texture_dim");
      updates.glb_decoded_ram_mb = num(fd, "glb_decoded_ram_mb");
      // Manual upload → mark provenance + generated time so the
      // "Meshy only runs once" gate trips correctly even if the
      // operator clears glb_url and re-runs Generate 3D later.
      updates.glb_source = "manual_upload";
      updates.glb_generated_at = new Date().toISOString();
      // Wave 9 — a fresh .glb invalidates any previous compressed
      // artifact. Reset the worker state to 'pending' and clear the
      // stale URL/size so the storefront falls back to glb_url
      // until the new compression run finishes. Dispatcher fires
      // below (inside after() after the DB UPDATE commits).
      updates.compression_status = "pending";
      updates.compression_error = null;
      updates.glb_compressed_url = null;
      updates.glb_compressed_size_kb = null;
    }
    // Wave 9 — FBX original (paid designer download). Independent of
    // the .glb dropzone: an operator can upload one without the other,
    // or both in the same Save. FBX bytes never enter any pipeline;
    // we just record the URL/size and serve via signed-URL download.
    const fbxPathInRequest = str(fd, "fbx_path");
    if (fbxPathInRequest) {
      if (!validFbxPath(fbxPathInRequest, id)) {
        redirect(
          `/admin/products/${id}/edit?err=upload&msg=${encodeURIComponent("invalid fbx path")}`,
        );
      }
      updates.fbx_url = fbxPublicUrl(id);
      updates.fbx_size_kb = num(fd, "fbx_size_kb");
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

  // ── Publish gates (Wave 2B · Commit 7) ──────────────────────
  //
  // Three gates in spec order. ANY save landing at status='published'
  // — whether via the Publish button (intent='publish') OR via Save
  // with PillGrid pre-set to Published (intent='save', Bug A path) —
  // must satisfy ALL three. Each gate failure redirects with an
  // explicit reason so the edit page can render a targeted nudge.
  //
  //   gate 1: room_slugs non-empty
  //   gate 2: cutout_approved count >= 1
  //   gate 3: glb_url non-empty (existing OR uploaded this request)
  //
  // Order matters for the redirect: we report the FIRST failing gate
  // in the order rooms → cutouts → glb. Operator fixes one at a
  // time and re-clicks Publish. Earlier gates (rooms) are usually
  // faster fixes (one click in a picker) so they fail first; later
  // gates (GLB) require running Generate 3D which takes minutes.
  if (payload.status === "published") {
    const facts = await loadPublishGateFacts(id);
    // Fresh values from this save override stale DB values:
    //  - rooms came from the form payload
    //  - glb_url may have just been set by the manual upload above
    const gate = checkPublishGates({
      rooms: payload.room_slugs ?? [],
      glbUrl: updates.glb_url ?? facts.glbUrl,
      cutoutApprovedCount: facts.cutoutApprovedCount,
    });
    if (!gate.ok) {
      redirect(
        `/admin/products/${id}/edit?err=publish_blocked&reason=${gate.reason}`,
      );
    }
  }

  const { error } = await supabase.from("products").update(updates).eq("id", id);
  if (error) {
    redirect(
      `/admin/products/${id}/edit?err=db&msg=${encodeURIComponent(error.message)}`,
    );
  }

  // Wave 9 — kick the Draco compression worker AFTER the row commits
  // so the operator's Save returns instantly. Only when this request
  // actually landed a fresh .glb (operators editing copy/dimensions
  // shouldn't waste 30-60 s of CPU re-compressing the same file).
  // The dispatcher is fire-and-forget against /api/admin/compress-glb
  // which has its own maxDuration=120; the row's state machine is:
  //   'pending' → 'processing' → ('done' | 'failed')
  // and the banner polls getCompressionStatus every 5 s.
  if (glbPathInRequest) {
    after(() => dispatchGlbCompression(id));
  }

  // Wave 11b — (re)build the FBX zip bundle when this save landed a
  // fresh .fbx OR new texture maps. The .fbx + textures already live
  // in Storage (signed-URL PUTs); the dispatcher fires the packager
  // route which zips model.fbx + textures/ and writes fbx_bundle_url.
  // Fire-and-forget — the bare fbx_url stays the download fallback
  // until the zip lands.
  // Re-read fbx_path here (the earlier parse lives inside the upload
  // try-block scope). str() is pure; cheap to read twice.
  const fbxPathForBundle = str(fd, "fbx_path");
  const texturesChanged = str(fd, "textures_changed");
  if (fbxPathForBundle || texturesChanged) {
    after(() => dispatchFbxBundle(id));
  }

  // Attach staged raw images (bytes already PUT client-side via signed
  // URL). Rows go in at state='raw'. NO rembg run — operator clicks
  // "Run Background Removal" when they're ready (Commit 5).
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

  // Wave 4 — staged real-photo uploads land alongside the cutouts in
  // the same Storage path, but with image_kind='real_photo' and a
  // terminal state so the rembg pipeline ignores them and the
  // storefront's real-photo strip picks them up immediately.
  const stagedRealPhotos = parseRealPhotoEntries(fd);
  if (stagedRealPhotos.length > 0) {
    const attach = await attachStagedRealPhotos(id, stagedRealPhotos);
    if (!attach.ok) {
      redirect(
        `/admin/products/${id}/edit?err=db&msg=${encodeURIComponent(
          `real-photo row insert failed: ${attach.error}`,
        )}`,
      );
    }
  }

  revalidatePath("/admin");
  revalidatePath("/");
  revalidatePath(`/product/${id}`);
  invalidatePublishedCountsCache();

  const qs = new URLSearchParams({ saved: "1" });
  if (stagedEntries.length > 0) qs.set("uploaded", String(stagedEntries.length));
  if (stagedRealPhotos.length > 0)
    qs.set("real_photos", String(stagedRealPhotos.length));
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

  // Wave 2B · Commit 7: same 3-gate enforcement updateProduct uses.
  // Wave 2B · Commit 9 takes the inline status dropdown UI off the
  // /admin list (StatusCell becomes a read-only badge), so in
  // practice this action no longer has a UI caller. But it's a
  // server action — URL-addressable forever — so defense-in-depth
  // gates the published transition here too. Without this, anyone
  // who knew the action's name could POST a published flip on a
  // GLB-less row and skip the redesigned Publish flow entirely.
  if (next === "published") {
    const facts = await loadPublishGateFacts(id);
    const gate = checkPublishGates(facts);
    if (!gate.ok) {
      redirect(
        `/admin?err=publish_blocked&reason=${gate.reason}&id=${encodeURIComponent(id)}`,
      );
    }
  }

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

  // Wave 2B · Commit 9: per-row 3-gate enforcement when next='published'.
  //
  // Bulk Publish was the loudest remaining back door — one click could
  // flip 50 GLB-less rows live. Each row goes through the same gates
  // updateProduct uses; failures are skipped (the bulk continues), and
  // the redirect carries back a `blocked=K` count so the operator
  // sees what got rejected without losing the rows that did succeed.
  //
  // Sequential queries on purpose: per-row gate facts are cheap (two
  // small queries each), and Phase 1's typical bulk size is ~10-20.
  // If the operator routinely bulk-publishes 200+ rows the loop can
  // be vectorized — for now sequential keeps the code straightforward
  // and the failure mode obvious if a single row's query throws.
  let targetIds = ids;
  let blockedCount = 0;
  let firstBlockedReason: PublishGateReason | null = null;
  if (next === "published") {
    const passed: string[] = [];
    for (const id of ids) {
      const facts = await loadPublishGateFacts(id);
      const result = checkPublishGates(facts);
      if (result.ok) {
        passed.push(id);
      } else {
        blockedCount++;
        if (!firstBlockedReason) firstBlockedReason = result.reason;
      }
    }
    if (passed.length === 0) {
      // Nothing to update — every selected row failed at least one
      // gate. Redirect with err so the dashboard's red toast renders.
      redirect(
        `/admin?err=publish_blocked&msg=${encodeURIComponent(
          `All ${ids.length} selected products are missing rooms, cutouts, or a GLB. Open each one to fix.`,
        )}`,
      );
    }
    targetIds = passed;
  }

  const { error } = await supabase
    .from("products")
    .update({ status: next })
    .in("id", targetIds);
  if (error) {
    redirect(`/admin?err=bulk&msg=${encodeURIComponent(error.message)}`);
  }
  revalidatePath("/admin");
  revalidatePath("/");
  invalidatePublishedCountsCache();

  const qs = new URLSearchParams({
    bulk: String(targetIds.length),
    status: next,
  });
  if (blockedCount > 0) {
    qs.set("blocked", String(blockedCount));
    if (firstBlockedReason) qs.set("reason", firstBlockedReason);
  }
  redirect(`/admin?${qs.toString()}`);
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
 * Variant: AI infer driven by client-staged photos (data URLs).
 *
 * Why two paths instead of always reading from Storage:
 *   - Phase 1's "审批式上传" (approval-based upload) defers Storage
 *     writes until the operator clicks Save. So on /products/new (or
 *     after dragging fresh photos onto an existing product), the
 *     `product_images` table is empty AND the bytes only live in the
 *     browser's File handles. The Storage-lookup path returned
 *     "Upload at least one product photo before running AI autofill."
 *     even when 5 photos were sitting in the dropzone preview grid.
 *   - Forcing the operator to Save first violates the natural flow:
 *     they came here to pick item-type/rooms/etc. — Save shouldn't
 *     be a precondition for the assist that helps them PICK those.
 *
 * The client (AIInferButton) downscales each staged File to ≤2048px
 * JPEG @ q=0.85 in a canvas, base64-encodes it as a data URL, and
 * passes the array here. We pipe those straight into
 * inferProductFields — OpenAI accepts data URLs in image_url just
 * like fetchable URLs.
 *
 * Size budget: Vercel's Server Actions body limit is 10MB
 * (next.config.ts). 3 × downscaled JPEGs (each ~200-500KB base64)
 * fits with comfortable headroom.
 */
const STAGED_DATA_URL_PREFIX = "data:image/";
const STAGED_TOTAL_BUDGET_BYTES = 9 * 1024 * 1024; // 9 MB safety margin under the 10 MB action limit

export async function runAiInferStaged(
  stagedImages: string[],
): Promise<RunAiInferResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: "Not signed in." };
  }

  if (!stagedImages || stagedImages.length === 0) {
    return { ok: false, error: "Drop a photo first, then click AI autofill." };
  }

  // Defensive shape check — malformed payloads should fail fast with
  // a useful message, not surface as an OpenAI 4xx.
  let totalBytes = 0;
  for (const url of stagedImages) {
    if (!url.startsWith(STAGED_DATA_URL_PREFIX)) {
      return {
        ok: false,
        error:
          "Internal: staged image is not a data URL — try removing and re-adding the photo.",
      };
    }
    // Rough byte count — data URL length × ¾ approximates the
    // decoded blob, plus the header. Good enough for a budget check.
    totalBytes += url.length;
  }
  if (totalBytes > STAGED_TOTAL_BUDGET_BYTES) {
    const mb = (totalBytes / 1024 / 1024).toFixed(1);
    return {
      ok: false,
      error: `Staged photos total ${mb} MB after encoding, over the 9 MB AI ingest limit. Remove a photo and try again.`,
    };
  }

  const limited = stagedImages.slice(0, AI_MAX_IMAGES);
  const result = await inferProductFields({ imageUrls: limited });

  return {
    ok: true,
    fields: result.fields as Record<string, unknown>,
    inferredKeys: result.inferredKeys,
    confidence: result.confidence,
    model: result.model,
    note: result.note,
    debug: {
      latency_ms: result.debug.latency_ms,
      imageCount: limited.length,
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

// ─── M3 · Commit 3: operator-driven retry ──────────────────────
//
// Thin wrapper around retryMeshyForProductCore. Adds the three
// things the core deliberately doesn't know about — admin cookie
// gate, request-shape validation, and Next cache revalidation —
// so the core stays callable from smoke scripts (no Next runtime).
//
// Same split pattern as updateProduct → kickOffMeshyForProduct.
//
// Surfaced via RetryMeshyButton inside the red MeshyStatusBanner.
// See src/lib/meshy-retry.ts for the full state-machine reasoning.

export async function retryMeshyForProduct(
  productId: string,
): Promise<
  | { ok: true; taskId: string }
  | { ok: false; error: string; code?: string }
> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: "Not signed in.", code: "unauthenticated" };
  }

  if (!UUID_RE.test(productId)) {
    return { ok: false, error: "invalid product id", code: "bad_request" };
  }

  const result = await retryMeshyForProductCore(productId);

  if (result.ok) {
    // Bust the cached edit page so a same-tab back/forward sees
    // the fresh row. The banner's own router.refresh() (called
    // by RetryMeshyButton on success) handles the current tab.
    revalidatePath(`/admin/products/${productId}/edit`);
  }

  return result;
}

// ─── Wave 2A · Commit 6: standalone "Generate 3D" ──────────────
//
// Publish-flow γ redesign — the held-back-status pattern (Publish
// silently kicks off Meshy then auto-promotes when the worker lands
// the GLB) is being retired in Wave 2B. This action is the explicit
// surface that replaces it: the operator clicks "Generate 3D" from
// MeshyStatusBanner when they're ready to spend the Meshy budget,
// independently of Save/Publish.
//
// Thin wrapper around kickOffMeshyForProduct (same shape as
// retryMeshyForProduct above): admin gate + UUID validation +
// revalidatePath. The kickoff helper already enforces the pre-flight
// gates (already_has_glb, already_in_flight, no_cutouts, etc.) so
// we just surface them through.
//
// On success, MeshyStatusBanner's polling loop picks up the new
// 'generating' status on the next 5s tick and flips the banner to
// the blue "3D 模型生成中" state — same UX as the legacy held-back
// path, just driven by an explicit click.

export async function generate3DForProduct(
  productId: string,
): Promise<
  | { ok: true; taskId: string }
  | { ok: false; error: string; code?: string }
> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: "Not signed in.", code: "unauthenticated" };
  }
  if (!UUID_RE.test(productId)) {
    return { ok: false, error: "invalid product id", code: "bad_request" };
  }

  const result = await kickOffMeshyForProduct(productId);
  if (!result.ok) {
    return { ok: false, error: result.detail ?? result.error, code: result.error };
  }

  revalidatePath(`/admin/products/${productId}/edit`);
  revalidatePath("/admin");
  return { ok: true, taskId: result.taskId };
}

// ────────────────────────────────────────────────────────────
// Wave 3 — Auto-fill from spec sheet (GPT-4o vision)
// ────────────────────────────────────────────────────────────

export type ParseSpecSheetResult =
  | {
      ok: true;
      result: SpecSheetParse;
      /** Storage path of the spec image we persisted (image_kind=
       *  'spec_sheet'). Useful if the operator wants to view it
       *  later. */
      specImagePath: string;
      /** Per-call cost in USD (rough — based on OpenAI's reported
       *  token counts). Echoed back to the UI so the operator can
       *  see what each parse cost. */
      estCostUsd: number;
    }
  | { ok: false; error: string };

const SPEC_SHEET_MAX_BYTES = 8 * 1024 * 1024; // 8 MB; same as raw photos
const SPEC_SHEET_ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/**
 * Wave 3 server action — operator uploads a brand spec sheet image,
 * we persist it (image_kind='spec_sheet'), forward to GPT-4o vision,
 * and return the structured suggestions to the client. The client
 * shows them in a per-field review card; nothing writes to products
 * until the operator clicks Save.
 *
 * Auth: requireAdmin. Rate limit: not enforced server-side yet —
 * the api_usage cap covers $-spend; if we see abuse we'll add a
 * per-day count cap like AIInferButton has client-side.
 *
 * Cost tracking: api_usage row written for telemetry. service tag
 * 'gpt4o_vision_spec' is new; existing services kept untouched.
 */
export async function parseSpecSheetAction(
  productId: string,
  fd: FormData,
): Promise<ParseSpecSheetResult> {
  await requireAdmin();
  if (!productId || !UUID_RE.test(productId)) {
    return { ok: false, error: "invalid product id" };
  }
  // Wave 5 (mig 0038) — operator picks an EXISTING product_images
  // row to parse instead of uploading a new spec sheet. The selected
  // image must be on the product AND have feed_to_ai=true. Spec
  // sheets the operator wants to keep around just go through the
  // normal photo upload path and have feed_to_ai toggled on.
  const imageId = fd.get("imageId")?.toString();
  if (!imageId || !UUID_RE.test(imageId)) {
    return { ok: false, error: "imageId required" };
  }

  const supabase = createServiceRoleClient();
  const { data: img, error: imgErr } = await supabase
    .from("product_images")
    .select("id, product_id, raw_image_url, cutout_image_url, feed_to_ai")
    .eq("id", imageId)
    .single();
  if (imgErr || !img) {
    return { ok: false, error: "image not found" };
  }
  if (img.product_id !== productId) {
    return { ok: false, error: "image belongs to a different product" };
  }
  if (!img.feed_to_ai) {
    return {
      ok: false,
      error: "this image has Feed to AI parser turned off",
    };
  }

  // Resolve bytes. Prefer cutout_image_url (already public PNG) over
  // signing the raw URL — fewer round trips for the common case
  // where the operator is parsing a cutout-pipeline-processed image.
  let imageBytes: Uint8Array;
  let mimeType: string;
  try {
    if (img.cutout_image_url) {
      const r = await fetch(img.cutout_image_url, { cache: "no-store" });
      if (!r.ok) throw new Error(`cutout fetch ${r.status}`);
      imageBytes = new Uint8Array(await r.arrayBuffer());
      mimeType = "image/png";
    } else if (img.raw_image_url) {
      const signedUrl = await getSignedRawUrl(img.raw_image_url);
      const r = await fetch(signedUrl, { cache: "no-store" });
      if (!r.ok) throw new Error(`raw fetch ${r.status}`);
      imageBytes = new Uint8Array(await r.arrayBuffer());
      // raw bytes mime: best-guess from extension. If the upload
      // pipeline normalized the path, the extension is reliable.
      const ext = img.raw_image_url.split(".").pop()?.toLowerCase() ?? "jpg";
      mimeType =
        ext === "png" ? "image/png" :
        ext === "webp" ? "image/webp" :
        "image/jpeg";
    } else {
      return { ok: false, error: "image has no fetchable URL" };
    }
  } catch (e) {
    return {
      ok: false,
      error: `image fetch failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (imageBytes.byteLength > SPEC_SHEET_MAX_BYTES) {
    return {
      ok: false,
      error: `image is ${(imageBytes.byteLength / 1024 / 1024).toFixed(1)} MB; max ${SPEC_SHEET_MAX_BYTES / 1024 / 1024} MB`,
    };
  }

  let parsed: { result: SpecSheetParse; usage: { promptTokens: number; completionTokens: number; estCostUsd: number } };
  try {
    parsed = await parseSpecSheet(imageBytes, mimeType);
  } catch (e) {
    return {
      ok: false,
      error: `gpt-4o call failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // Track cost in api_usage. service is a free-form text column
  // (mig 0006), so adding a new service tag costs no schema change.
  await supabase.from("api_usage").insert({
    service: "gpt4o_vision_spec",
    product_id: productId,
    product_image_id: imageId,
    cost_usd: Number(parsed.usage.estCostUsd.toFixed(6)),
    status: "ok",
    note: `prompt=${parsed.usage.promptTokens} completion=${parsed.usage.completionTokens}`,
  });

  return {
    ok: true,
    result: parsed.result,
    specImagePath: img.cutout_image_url ?? img.raw_image_url ?? "",
    estCostUsd: parsed.usage.estCostUsd,
  };
}

// ────────────────────────────────────────────────────────────
// Wave 6 — multi-image merged parse
// ────────────────────────────────────────────────────────────

export type ParseImagesMergedResult =
  | {
      ok: true;
      result: SpecSheetParse;
      imagesParsed: number;
      estCostUsd: number;
    }
  | { ok: false; error: string };

/** Wave 6 — operator picks 1–5 of the product's feed_to_ai images,
 *  the action sends them all to GPT-4o in one call. Used by the
 *  single-product Auto-fill block (multi-select) AND by Wave 6's
 *  bulkCreateProducts post-create AI fill.
 *
 *  Differences vs. parseSpecSheetAction:
 *   • Accepts an array of imageIds, not one.
 *   • Logs ONE api_usage row tagged 'gpt4o_vision_spec_merged' with
 *     all imageIds in the note field (the column is 1-to-1 on
 *     product_image_id, so we leave it null and put the list in
 *     note instead).
 *   • Uses public cutout_image_url when present (no signing round-
 *     trip; OpenAI fetches directly). Falls back to short-lived
 *     signed URLs for raw-only rows. */
export async function parseSpecSheetMergedAction(
  productId: string,
  imageIds: string[],
): Promise<ParseImagesMergedResult> {
  await requireAdmin();
  if (!productId || !UUID_RE.test(productId)) {
    return { ok: false, error: "invalid product id" };
  }
  if (imageIds.length === 0) {
    return { ok: false, error: "pick at least one image" };
  }
  if (imageIds.length > MERGED_PARSE_MAX_IMAGES) {
    return {
      ok: false,
      error: `pick up to ${MERGED_PARSE_MAX_IMAGES} images per call`,
    };
  }
  for (const id of imageIds) {
    if (!UUID_RE.test(id)) {
      return { ok: false, error: "invalid image id" };
    }
  }

  const supabase = createServiceRoleClient();
  const { data: imgs, error: imgErr } = await supabase
    .from("product_images")
    .select("id, product_id, raw_image_url, cutout_image_url, feed_to_ai")
    .in("id", imageIds);
  if (imgErr) {
    return { ok: false, error: `db error: ${imgErr.message}` };
  }
  if (!imgs || imgs.length !== imageIds.length) {
    return { ok: false, error: "one or more images not found" };
  }
  for (const img of imgs) {
    if (img.product_id !== productId) {
      return {
        ok: false,
        error: "an image belongs to a different product",
      };
    }
    if (!img.feed_to_ai) {
      return {
        ok: false,
        error:
          "an image has Feed to AI parser turned off — toggle it on first",
      };
    }
  }

  // Resolve URLs for the GPT call. Prefer public cutout URL; fall
  // back to a short-lived signed URL for raw-only rows.
  const inputs: { url: string }[] = [];
  for (const img of imgs) {
    if (img.cutout_image_url) {
      inputs.push({ url: img.cutout_image_url });
    } else if (img.raw_image_url) {
      try {
        const signed = await getSignedRawUrl(img.raw_image_url);
        inputs.push({ url: signed });
      } catch (e) {
        return {
          ok: false,
          error: `signed-url failed: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    } else {
      return { ok: false, error: "an image has no fetchable URL" };
    }
  }

  let parsed: Awaited<ReturnType<typeof parseImagesMerged>>;
  try {
    parsed = await parseImagesMerged(inputs);
  } catch (e) {
    return {
      ok: false,
      error: `gpt-4o call failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  await supabase.from("api_usage").insert({
    service: "gpt4o_vision_spec_merged",
    product_id: productId,
    product_image_id: null, // multi — not tied to a single image
    cost_usd: Number(parsed.usage.estCostUsd.toFixed(6)),
    status: "ok",
    note: `images=${imageIds.length} prompt=${parsed.usage.promptTokens} completion=${parsed.usage.completionTokens} ids=${imageIds.join(",")}`,
  });

  return {
    ok: true,
    result: parsed.result,
    imagesParsed: parsed.imageCount,
    estCostUsd: parsed.usage.estCostUsd,
  };
}

// ────────────────────────────────────────────────────────────
// Wave 6 · Commit 3 — bulk-create draft products
// ────────────────────────────────────────────────────────────

/** Sync upper bound on a single bulk-create call. The bulk page caps
 *  the operator at this number too, but server-side enforcement
 *  matters because server actions are URL-addressable. */
const BULK_CREATE_MAX = 10;

/** Wave 7 fix-2 — per-photo type the operator picked in the
 *  bulk-create card dropdown.
 *
 *   "product"   — show in storefront, run through rembg,
 *                 image_kind='cutout'
 *   "reference" — spec sheet / web screenshot. SKIP rembg (otherwise
 *                 text gets shredded), HIDE from storefront,
 *                 image_kind='real_photo' (Wave 4's enum value whose
 *                 documented semantics already mean "skip rembg")
 *
 *  feed_to_ai is true for BOTH so V2 reads everything (V2 wants the
 *  spec sheet too — that's where the SKU usually lives).
 */
export type BulkPhotoType = "product" | "reference";

export type BulkCreateDraft = {
  /** Pre-minted product UUID. The client uses this id when calling
   *  getSignedUploadUrl, so the storage paths line up exactly with
   *  what the existing single-product pipeline expects. */
  productId: string;
  /** 1-5 photos already direct-uploaded via signed URLs. `type`
   *  drives the per-row pipeline branch (see BulkPhotoType). */
  images: Array<{ imageId: string; ext: string; type?: BulkPhotoType }>;
  /** Optional GLB metadata. The client direct-uploaded bytes to
   *  `products/<productId>/model.glb` via the existing signed-URL
   *  flow; we just persist the budget metadata + glb_url here.
   *  Null / undefined → no GLB attached. */
  glb?: {
    sizeKb: number | null;
    vertexCount: number | null;
    maxTextureDim: number | null;
    decodedRamMb: number | null;
  } | null;
  /** Wave 9 — optional FBX original. Bytes direct-uploaded to
   *  `products/<productId>/model.fbx` via the new "fbx" signed-URL
   *  kind. We just persist fbx_url + fbx_size_kb. Independent of
   *  the GLB block. */
  fbx?: {
    sizeKb: number;
  } | null;
  /** Wave 9 — optional real-world dimensions in mm. Same shape as
   *  the existing dimensions_mm JSONB column; the storefront
   *  ModelViewer reads this to rescale AR placement. */
  dimensions_mm?: {
    length?: number;
    width?: number;
    height?: number;
  } | null;
};

export type BulkCreateResult =
  | { ok: true; created: Array<{ productId: string }> }
  | { ok: false; error: string };

/** Wave 6 · Commit 3 — create up to 10 draft products in one call.
 *
 *  Synchronous part:
 *    1. INSERT products (status='draft', name='Untitled product')
 *    2. INSERT product_images (state='raw', feed_to_ai=true,
 *       show_on_storefront=true, first row is_primary_thumbnail=true)
 *    3. UPDATE products.glb_url + budget metadata when a GLB landed
 *
 *  Asynchronous tail (next/server `after`):
 *    4. Run rembg AUTO on each image of each new product. The DB
 *       maintain_primary_thumbnail trigger + the unify-thumbnail
 *       pg_net hook fire automatically once cutouts land — same
 *       single-product pipeline.
 *    5. After rembg, run parseImagesMerged on the cutouts and UPDATE
 *       the product with the parsed name/sku_id/brand/description/
 *       dimensions_mm/weight_kg + bump ai_filled_fields.
 *
 *  Bytes are NOT copied — the client direct-uploaded via signed URLs
 *  to the canonical paths the single-product flow uses, since the
 *  productId is minted client-side and shipped here.
 */
export async function bulkCreateProducts(
  drafts: BulkCreateDraft[],
): Promise<BulkCreateResult> {
  await requireAdmin();

  if (!Array.isArray(drafts) || drafts.length === 0) {
    return { ok: false, error: "no drafts provided" };
  }
  if (drafts.length > BULK_CREATE_MAX) {
    return { ok: false, error: `max ${BULK_CREATE_MAX} drafts per request` };
  }

  // Per-draft validation. Reject the WHOLE batch on any malformed
  // entry — bulk create is meant for happy-path scanning; partial
  // recovery just leaves a half-broken batch the operator has to clean
  // up. Defense-in-depth against a hand-crafted POST that tries to
  // wedge a `../` into raw_image_url or point at someone else's GLB.
  for (const d of drafts) {
    if (!UUID_RE.test(d.productId)) {
      return { ok: false, error: `invalid productId: ${d.productId}` };
    }
    if (!Array.isArray(d.images) || d.images.length === 0) {
      return {
        ok: false,
        error: `draft ${d.productId} has no images (need at least 1)`,
      };
    }
    if (d.images.length > MAX_IMAGES_PER_PRODUCT) {
      return {
        ok: false,
        error: `draft ${d.productId} has more than ${MAX_IMAGES_PER_PRODUCT} images`,
      };
    }
    for (const img of d.images) {
      if (!UUID_RE.test(img.imageId)) {
        return { ok: false, error: `invalid imageId: ${img.imageId}` };
      }
      if (!ALLOWED_IMAGE_EXTS.has(img.ext.toLowerCase())) {
        return { ok: false, error: `unsupported ext: ${img.ext}` };
      }
      if (img.type != null && img.type !== "product" && img.type !== "reference") {
        return { ok: false, error: `invalid image type: ${img.type}` };
      }
    }
  }

  const supabase = createServiceRoleClient();

  // 1. Insert products. One INSERT per row keeps error messages
  //    targeted (the client gets which productId failed); insert-many
  //    coalesces to one error and we'd lose the binding. ~10 rows so
  //    the latency penalty is negligible.
  for (const d of drafts) {
    const { error } = await supabase.from("products").insert({
      id: d.productId,
      name: "Untitled product",
      status: "draft",
      room_slugs: [],
      styles: [],
      colors: [],
      materials: [],
      store_locations: [],
      ai_filled_fields: [],
    });
    if (error) {
      return {
        ok: false,
        error: `product insert ${d.productId} failed: ${error.message}`,
      };
    }
  }

  // 2. Insert product_images. Wave 11b — DEFAULT = use raw as-is
  //    (no rembg). Jym switched to Wiltek's rendered scene photos and
  //    does NOT want bulk-create auto-removing backgrounds (it
  //    destroyed those renders). So BOTH photo types now land at
  //    cutout_approved with the raw bytes copied into the public
  //    cutouts bucket — no rembg fires in the async tail anymore.
  //
  //    type='product'   — image_kind='cutout', show_on_storefront=true,
  //                       skip_cutout=true (used as-is), first one is
  //                       the primary thumbnail. Operator opts INTO
  //                       background removal per-image later via the
  //                       "Remove Background" button.
  //    type='reference' — image_kind='real_photo', show_on_storefront
  //                       =false (operator-only spec sheets); still
  //                       feed_to_ai=true (V2 reads SKUs off them).
  //
  //    The publish gate (cutout_approved≥1) is satisfied by the first
  //    product photo; AI parse in the async tail still runs.
  for (const d of drafts) {
    let primaryAssigned = false;
    let newPrimaryThumbUrl: string | null = null;
    for (const img of d.images) {
      const type: BulkPhotoType = img.type ?? "product";
      const isProduct = type === "product";
      const isPrimary = isProduct && !primaryAssigned;
      if (isPrimary) primaryAssigned = true;
      const ext = img.ext.toLowerCase();
      const rawPath = `${d.productId}/${img.imageId}.${ext}`;
      // Copy raw → public cutouts so the card/thumbnail resolve to a
      // public CDN URL (skip_cutout = "use as-is, no rembg").
      let publicUrl: string;
      try {
        publicUrl = await copyRawToCutouts(rawPath, d.productId, img.imageId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          error: `copy ${img.imageId} for ${d.productId} failed: ${msg}`,
        };
      }
      const { error } = await supabase.from("product_images").insert({
        id: img.imageId,
        product_id: d.productId,
        state: "cutout_approved" as const,
        raw_image_url: rawPath,
        cutout_image_url: publicUrl,
        image_kind: (isProduct ? "cutout" : "real_photo") as
          | "cutout"
          | "real_photo",
        skip_cutout: isProduct, // reference rows aren't "skipped cutouts"
        feed_to_ai: true,
        show_on_storefront: isProduct,
        is_primary: isPrimary,
        is_primary_thumbnail: isPrimary,
      });
      if (error) {
        return {
          ok: false,
          error: `image insert for ${d.productId} failed: ${error.message}`,
        };
      }
      if (isPrimary) newPrimaryThumbUrl = publicUrl;
    }
    // Wave 11b — set the card thumbnail to the raw copy directly. The
    // INSERT above does NOT fire the unify trigger (it watches UPDATE
    // state-transitions), and mig 0037 dropped the legacy sync trigger,
    // so without this the storefront card shows the "3D · AR"
    // placeholder. Unify Center later overwrites it with the unified
    // PNG. (Skip drafts that had no product photo — reference-only.)
    if (newPrimaryThumbUrl) {
      const { error: thumbErr } = await supabase
        .from("products")
        .update({ thumbnail_url: newPrimaryThumbUrl })
        .eq("id", d.productId);
      if (thumbErr) {
        return {
          ok: false,
          error: `thumbnail set for ${d.productId} failed: ${thumbErr.message}`,
        };
      }
    }
  }

  // 3. Wave 9 — GLB + FBX + dimensions columns, in one UPDATE per
  //    draft so the row reaches its final shape in one round-trip.
  //    Bytes already live at the canonical storage paths via the
  //    signed-URL flow (model.glb / model.fbx).
  //
  //    glb_url + budget metadata → for storefront iOS OOM gate
  //    fbx_url + fbx_size_kb     → for paid designer download button
  //    dimensions_mm             → drives ModelViewer real-scale prop
  //    compression_status        → pending, triggers Draco worker
  //                                in the async tail
  for (const d of drafts) {
    if (!d.glb && !d.fbx && !d.dimensions_mm) continue;

    const update: ProductUpdate = {};
    if (d.glb) {
      update.glb_url = glbPublicUrl(d.productId);
      update.glb_size_kb = d.glb.sizeKb;
      update.glb_vertex_count = d.glb.vertexCount;
      update.glb_max_texture_dim = d.glb.maxTextureDim;
      update.glb_decoded_ram_mb = d.glb.decodedRamMb;
      update.glb_source = "manual_upload" as const;
      update.glb_generated_at = new Date().toISOString();
      // Queue compression. The async tail below fires the dispatcher
      // after the rembg loop so the operator's response returns
      // before either worker starts; the compression banner on the
      // single-product edit page polls and shows progress.
      update.compression_status = "pending";
      update.compression_error = null;
      update.glb_compressed_url = null;
      update.glb_compressed_size_kb = null;
    }
    if (d.fbx) {
      update.fbx_url = fbxPublicUrl(d.productId);
      update.fbx_size_kb = d.fbx.sizeKb;
    }
    if (d.dimensions_mm) {
      update.dimensions_mm = d.dimensions_mm;
    }

    const { error } = await supabase
      .from("products")
      .update(update)
      .eq("id", d.productId);
    if (error) {
      return {
        ok: false,
        error: `glb/fbx/dims update ${d.productId} failed: ${error.message}`,
      };
    }
  }

  // Cache invalidations for the list page.
  revalidatePath("/admin");
  invalidatePublishedCountsCache();

  // 4 + 5. Async tail. Per-draft: rembg one image at a time (the rembg
  //    layer's advisory-lock quota gate makes concurrent calls
  //    effectively serial anyway), then merged parse against the
  //    cutouts that landed. Failures get logged and don't crash the
  //    batch — operator can retry from the list page.
  after(async () => {
    for (const d of drafts) {
      try {
        await processDraftAsync(d);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(
          `[bulkCreateProducts] async tail for ${d.productId} threw: ${msg}`,
        );
      }
      // Wave 9 — fire Draco compression for drafts that landed a
      // GLB. Independent of the rembg loop above; the dispatcher
      // just POSTs to /api/admin/compress-glb with the cron secret,
      // which has its own maxDuration=120 budget. Fire-and-forget
      // so a failed compression doesn't block the next draft.
      if (d.glb) {
        try {
          await dispatchGlbCompression(d.productId);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(
            `[bulkCreateProducts] compression dispatch for ${d.productId} threw: ${msg}`,
          );
        }
      }
    }
  });

  return {
    ok: true,
    created: drafts.map((d) => ({ productId: d.productId })),
  };
}

/** Load the taxonomy slug dictionary the V2 parser needs. Uses the
 *  service-role client (no RLS surprises) and picks only the columns
 *  the V2 prompt renders. */
async function loadTaxonomyHints(): Promise<TaxonomyHints> {
  const supabase = createServiceRoleClient();
  const [it, sub, rm, st, mt, co] = await Promise.all([
    supabase.from("item_types").select("slug,label_en"),
    supabase.from("item_subtypes").select("slug,label_en,item_type_slug"),
    supabase.from("rooms").select("slug,label_en"),
    supabase.from("styles").select("slug,label_en"),
    supabase.from("materials").select("slug,label_en"),
    supabase.from("colors").select("slug,label_en"),
  ]);
  return {
    itemTypes: it.data ?? [],
    itemSubtypes: sub.data ?? [],
    rooms: rm.data ?? [],
    styles: st.data ?? [],
    materials: mt.data ?? [],
    colors: co.data ?? [],
  };
}

/** Wave 7 · Commit 2 — per-product async tail. Runs rembg AUTO, then
 *  V2 parse + apply ALL fields (scalars + taxonomy), then attempts
 *  confidence-gated auto-publish.
 *
 *  ── Hotfix (Wave 7 follow-up) — parallelize rembg + V2 ──
 *
 *  Original implementation ran rembg sequentially THEN called V2.
 *  At 5 photos × ~12s rembg = 60s + V2 5-10s + apply = 65-75s. The
 *  Vercel after() callback budget is the function's maxDuration (60s
 *  default on Pro). Five-photo bulk-creates were getting killed
 *  mid-loop with the products stuck at name='Untitled product' /
 *  empty ai_filled_fields and images at state='raw' (the operator
 *  saw "Retry rembg" labels — the UI doesn't distinguish "in
 *  progress" from "stuck").
 *
 *  V2 doesn't depend on cutouts being approved — it accepts signed
 *  raw URLs as a documented fallback. So we kick off rembg AND V2
 *  in parallel:
 *    • Promise.all(image[] -> runRembgForImage) for rembg.
 *    • Resolve V2-input URLs from raw_image_url (signed), call V2
 *      against those.
 *  Both branches share the after() budget but finish in max(rembg,
 *  V2) ≈ 12-15s for typical 5-photo loads, comfortably under 60s.
 *
 *  Auto-publish requires:
 *    1. name + item_type + at least 1 room
 *    2. zero fields with confidence='low'
 *    3. existing 3-gate Publish check (rooms + cutout_approved >= 1 +
 *       glb_url)
 *
 *  Any of these failing → product stays at status='draft' AND
 *  missing_fields is populated.
 *
 *  Errors log + return — they don't propagate. */
async function processDraftAsync(d: BulkCreateDraft): Promise<void> {
  const supabase = createServiceRoleClient();

  // ── V2 input URL resolution (raw signed URLs, no cutout wait) ──
  //
  // We sign raw_image_url for each feed_to_ai image and hand those to
  // GPT-4o. Read raw_image_url straight from the product_images rows
  // we already INSERTed in the sync part — they're guaranteed to
  // exist (state='raw' at this point).
  const { data: imgs } = await supabase
    .from("product_images")
    .select("id, raw_image_url, feed_to_ai")
    .eq("product_id", d.productId)
    .eq("feed_to_ai", true)
    .order("created_at", { ascending: true })
    .limit(MERGED_PARSE_MAX_IMAGES);
  if (!imgs || imgs.length === 0) return;

  const v2Inputs: { url: string }[] = [];
  for (const img of imgs) {
    if (!img.raw_image_url) continue;
    try {
      const signed = await getSignedRawUrl(img.raw_image_url);
      v2Inputs.push({ url: signed });
    } catch {
      // skip rows we can't sign; keep the rest going
    }
  }

  // ── V2 AI parse only — NO rembg (Wave 11b) ──
  //
  // Wave 11b removed the auto-rembg branch entirely. Jym switched the
  // catalog to Wiltek's rendered scene photos and does not want
  // bulk-create stripping their backgrounds. The image-insert loop
  // above now lands every product photo at cutout_approved as-is
  // (skip_cutout), so there's nothing for rembg to do here and the
  // publish gate is already satisfied. The operator opts INTO
  // background removal per-image from the edit page if they ever
  // want it.
  //
  // V2 still runs: it reads feed_to_ai=true rows (Product + Reference)
  // and merges the SKU off the spec sheet with the visual identity
  // off the hero photo.
  let taxonomy: TaxonomyHints;
  try {
    taxonomy = await loadTaxonomyHints();
  } catch (e) {
    console.error(
      `[bulkCreateProducts] taxonomy load failed for ${d.productId}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return;
  }

  const parsed =
    v2Inputs.length > 0
      ? await parseImagesMergedV2(v2Inputs, taxonomy).catch((e) => {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(
            `[bulkCreateProducts] V2 parse for ${d.productId} failed: ${msg}`,
          );
          return null;
        })
      : null;
  if (!parsed) return;

  // Drop hallucinated slugs (defense-in-depth — strict-mode schema
  // already constrains shape, but the prompt could in principle leak
  // a slug not in the allowed set).
  const sanitized = sanitizeV2Slugs(parsed.result, taxonomy);

  const { error: usageErr } = await supabase.from("api_usage").insert({
    service: "gpt4o_vision_spec_v2",
    product_id: d.productId,
    product_image_id: null,
    cost_usd: Number(parsed.usage.estCostUsd.toFixed(6)),
    status: "ok",
    note: `bulk-v2 images=${v2Inputs.length} prompt=${parsed.usage.promptTokens} completion=${parsed.usage.completionTokens}`,
  });
  if (usageErr) {
    // Telemetry-only — don't fail the product apply on a usage write
    // miss. But DO log it: the original bug here was that the
    // api_usage CHECK constraint silently dropped writes for years
    // because supabase-js returns {error} (no throw) and the call-site
    // didn't inspect it. Logging closes that blind spot.
    console.error(
      `[bulkCreateProducts] api_usage write failed for ${d.productId}: ${usageErr.message}`,
    );
  }

  // Apply parsed fields. Only OVERWRITE on a non-null parsed value —
  // a model that couldn't read a field returns null, and we don't
  // want to clobber the DB default with that. Track each field's
  // confidence in ai_confidences, and the truly-null ones in
  // missing_fields.
  const f = sanitized.fields;
  const updates: ProductUpdate = {};
  const filled: string[] = [];
  const confidences: Record<string, Confidence> = {};
  const missing: string[] = [];

  // Scalars
  if (f.name.value && f.name.value.trim()) {
    updates.name = f.name.value.trim();
    filled.push("name");
    confidences.name = f.name.confidence;
  } else {
    missing.push("name");
  }
  if (f.brand.value && f.brand.value.trim()) {
    updates.brand = f.brand.value.trim();
    filled.push("brand");
    confidences.brand = f.brand.confidence;
  } else {
    missing.push("brand");
  }
  if (f.sku_id.value && f.sku_id.value.trim()) {
    updates.sku_id = f.sku_id.value.trim();
    filled.push("sku_id");
    confidences.sku_id = f.sku_id.confidence;
  } else {
    missing.push("sku_id");
  }
  if (f.description.value && f.description.value.trim()) {
    updates.description = f.description.value.trim();
    filled.push("description");
    confidences.description = f.description.confidence;
  } else {
    missing.push("description");
  }

  // Dimensions: only persist when at least one axis is > 0.
  const dims = f.dimensions_mm.value;
  const dimsFilled =
    dims &&
    [dims.length, dims.width, dims.height].some(
      (v) => typeof v === "number" && v > 0,
    );
  if (dims && dimsFilled) {
    const out: { length?: number; width?: number; height?: number } = {};
    if (typeof dims.length === "number" && dims.length > 0)
      out.length = dims.length;
    if (typeof dims.width === "number" && dims.width > 0) out.width = dims.width;
    if (typeof dims.height === "number" && dims.height > 0)
      out.height = dims.height;
    updates.dimensions_mm = out;
    filled.push("dimensions_mm");
    confidences.dimensions_mm = f.dimensions_mm.confidence;
  } else {
    missing.push("dimensions_mm");
  }
  if (typeof f.weight_kg.value === "number" && f.weight_kg.value > 0) {
    updates.weight_kg = f.weight_kg.value;
    filled.push("weight_kg");
    confidences.weight_kg = f.weight_kg.confidence;
  } else {
    missing.push("weight_kg");
  }

  // Taxonomy
  if (f.item_type_slug.value) {
    updates.item_type = f.item_type_slug.value;
    filled.push("item_type");
    confidences.item_type = f.item_type_slug.confidence;
  } else {
    missing.push("item_type");
  }
  if (f.subtype_slug.value) {
    updates.subtype_slug = f.subtype_slug.value;
    filled.push("subtype_slug");
    confidences.subtype_slug = f.subtype_slug.confidence;
  }
  // subtype is genuinely optional on many item_types, so we don't
  // add it to `missing` when null.

  if (f.room_slugs.value && f.room_slugs.value.length > 0) {
    updates.room_slugs = f.room_slugs.value;
    filled.push("room_slugs");
    confidences.room_slugs = f.room_slugs.confidence;
  } else {
    missing.push("room_slugs");
  }
  if (f.style_slugs.value && f.style_slugs.value.length > 0) {
    updates.styles = f.style_slugs.value;
    filled.push("styles");
    confidences.styles = f.style_slugs.confidence;
  }
  if (f.material_slugs.value && f.material_slugs.value.length > 0) {
    updates.materials = f.material_slugs.value;
    filled.push("materials");
    confidences.materials = f.material_slugs.confidence;
  }
  if (f.color_slugs.value && f.color_slugs.value.length > 0) {
    updates.colors = f.color_slugs.value;
    filled.push("colors");
    confidences.colors = f.color_slugs.confidence;
  }

  updates.ai_filled_fields = filled;
  updates.ai_confidences = confidences;
  updates.missing_fields = missing;

  const { error: applyErr } = await supabase
    .from("products")
    .update(updates)
    .eq("id", d.productId);
  if (applyErr) {
    console.error(
      `[bulkCreateProducts] apply for ${d.productId} failed: ${applyErr.message}`,
    );
    return;
  }

  // ── Confidence-gated auto-publish ───────────────────────────────
  // Required to even attempt: name + item_type + 1+ rooms (Wave 7
  // spec's "minimum publishable" set). Without these the storefront
  // surfaces wouldn't make sense.
  const hasMinimum =
    !!updates.name && !!updates.item_type && (updates.room_slugs?.length ?? 0) > 0;
  // ANY low-confidence field disqualifies — operator should see it
  // first.
  const anyLow = Object.values(confidences).some((c) => c === "low");

  if (!hasMinimum || anyLow) {
    // Persist a reason on missing_fields so the list explains why we
    // didn't auto-publish.
    const reasons = [...missing];
    if (anyLow) {
      for (const [k, c] of Object.entries(confidences)) {
        if (c === "low") reasons.push(`${k}_low_confidence`);
      }
    }
    await supabase
      .from("products")
      .update({ missing_fields: [...new Set(reasons)] })
      .eq("id", d.productId);
    revalidatePath("/admin");
    return;
  }

  // Existing 3-gate check: rooms + cutout_approved >= 1 + glb_url.
  const facts = await loadPublishGateFacts(d.productId);
  // Fresh values from this run override stale DB reads where possible.
  const gate = checkPublishGates({
    rooms: updates.room_slugs ?? facts.rooms,
    cutoutApprovedCount: facts.cutoutApprovedCount,
    glbUrl: facts.glbUrl,
  });
  if (!gate.ok) {
    await supabase
      .from("products")
      .update({
        missing_fields: [...new Set([...missing, `publish_gate_${gate.reason}`])],
      })
      .eq("id", d.productId);
    revalidatePath("/admin");
    return;
  }

  // All green — flip to published.
  await supabase
    .from("products")
    .update({ status: "published" })
    .eq("id", d.productId);
  invalidatePublishedCountsCache();
  revalidatePath("/admin");
  revalidatePath("/");
  revalidatePath(`/product/${d.productId}`);
}
