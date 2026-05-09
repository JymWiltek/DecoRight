"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  glbPublicUrl,
  uploadThumbnail,
  uploadRawImage,
  getSignedRawUrl,
  thumbnailPublicUrl,
} from "@/lib/storage";
import { inferProductFields } from "@/lib/ai/infer";
import { parseSpecSheet, type SpecSheetParse } from "@/lib/ai/parse-spec";
import { randomUUID } from "node:crypto";
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
    // Mig 0034 — explicit; matches DB default but documents intent.
    image_kind: "cutout" as const,
  }));
  const { error } = await supabase
    .from("product_images")
    .upsert(rows, { onConflict: "id" });
  if (error) return { ok: false, error: error.message };
  return { ok: true, ids: rows.map((r) => r.id) };
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
      .eq("state", "cutout_approved"),
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
  const file = fd.get("spec_image");
  if (!(file instanceof File)) {
    return { ok: false, error: "spec_image file is required" };
  }
  if (file.size > SPEC_SHEET_MAX_BYTES) {
    return {
      ok: false,
      error: `spec image is ${(file.size / 1024 / 1024).toFixed(1)} MB; max ${SPEC_SHEET_MAX_BYTES / 1024 / 1024} MB`,
    };
  }
  if (file.type && !SPEC_SHEET_ALLOWED_MIME.has(file.type)) {
    return {
      ok: false,
      error: `unsupported format ${file.type}; use JPEG / PNG / WebP`,
    };
  }

  // 1. Persist the image into raw-images storage + product_images
  // table with image_kind='spec_sheet' so it's associated with the
  // product but invisible to the storefront / rembg pipeline.
  const supabase = createServiceRoleClient();
  const imageId = randomUUID();
  let storagePath: string;
  try {
    storagePath = await uploadRawImage(productId, imageId, file);
  } catch (e) {
    return {
      ok: false,
      error: `storage upload failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  const { error: rowErr } = await supabase.from("product_images").insert({
    id: imageId,
    product_id: productId,
    raw_image_url: storagePath,
    cutout_image_url: null,
    state: "cutout_approved", // terminal — won't be picked up by rembg
    image_kind: "spec_sheet",
    is_primary: false,
  });
  if (rowErr) {
    return {
      ok: false,
      error: `product_images insert failed: ${rowErr.message}`,
    };
  }

  // 2. Send the bytes to GPT-4o vision.
  const buf = new Uint8Array(await file.arrayBuffer());
  let parsed: { result: SpecSheetParse; usage: { promptTokens: number; completionTokens: number; estCostUsd: number } };
  try {
    parsed = await parseSpecSheet(buf, file.type || "image/jpeg");
  } catch (e) {
    return {
      ok: false,
      error: `gpt-4o call failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // 3. Track cost in api_usage. service is a free-form text column
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
    specImagePath: storagePath,
    estCostUsd: parsed.usage.estCostUsd,
  };
}
