/**
 * Phase A · Milestone 3 · Commit 3 smoke
 *
 * Validates `retryMeshyForProductCore(productId)` — the gate logic
 * + reset + kick-off composition that backs the "重新生成 3D 模型"
 * button on the red MeshyStatusBanner.
 *
 * No real Meshy money spent: forces MESHY_API_KEY to Meshy's
 * public test-mode value (`msy_dummy_…`) like Commits 1-2.
 *
 * The smoke targets the testable core, not the action wrapper —
 * the wrapper just adds requireAdmin + UUID_RE + revalidatePath,
 * none of which work outside a Next request context. Same split
 * the Commit 1 smoke uses (kickOffMeshyForProduct, not the
 * action).
 *
 * Cases:
 *
 *   [1] happy path: draft + failed + 2 cutouts
 *       → ok=true; DB row reads meshy_status='generating',
 *         meshy_task_id stamped, meshy_attempts=0,
 *         meshy_error=null.
 *
 *   [2] wrong_meshy_status: draft + null
 *       → refused with code='wrong_meshy_status'; row UNCHANGED
 *         (the gate runs before the reset write, so a stale
 *         retry click can't accidentally clobber a healthy row).
 *
 *   [3] wrong_meshy_status: draft + succeeded
 *       → refused; row unchanged. Catches the "operator double-
 *         clicked retry after the worker already promoted the
 *         row" race.
 *
 *   [4] wrong_status: published + failed
 *       → refused with code='wrong_status'. Anchors the iron
 *         rule: a published row never re-runs Meshy regardless
 *         of meshy_status. (This combo can happen if the
 *         operator manually uploaded a GLB after a Meshy
 *         failure — the row went published-via-manual but the
 *         meshy_status='failed' history stuck around.)
 *
 *   [5] already_has_glb: draft + failed + glb_url set
 *       → refused with code='already_has_glb'. Belt-and-braces
 *         on the "Meshy never overwrites a GLB" rule.
 *
 *   [6] no_cutouts on retry: draft + failed + 0 cutouts
 *       → refused with code='no_cutouts' (forwarded from
 *         kickOff). Critically: the row is left at meshy_status
 *         ='failed' (not 'pending') so the banner doesn't lie
 *         about a non-existent in-flight job. meshy_error reads
 *         "retry blocked: no_cutouts".
 *
 *   [7] product_missing
 *       → refused with code='product_missing'.
 *
 * Cleanup: deletes all fixture products + image rows.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/smoke-m3-commit3.ts
 */
import { createServiceRoleClient } from "../src/lib/supabase/service";
import { retryMeshyForProductCore } from "../src/lib/meshy-retry";

// Force Meshy test-mode regardless of what's in .env.local. Per
// Jym's rule: "commit 1-5 用 mock, 不烧真 credit".
const TEST_KEY = "msy_dummy_api_key_for_test_mode_12345678";
process.env.MESHY_API_KEY = TEST_KEY;

// 00000003-… namespace = M3 fixtures. The 0x100+ block keeps
// Commit 3 fixtures distinct from Commit 1's (0x001-0x005) and
// Commit 2's (0x099) so concurrent smokes don't trample each
// other.
const FIXTURES = {
  happy: "00000003-0000-4000-8000-000000000101",
  draftNull: "00000003-0000-4000-8000-000000000102",
  draftSucceeded: "00000003-0000-4000-8000-000000000103",
  publishedFailed: "00000003-0000-4000-8000-000000000104",
  draftFailedHasGlb: "00000003-0000-4000-8000-000000000105",
  draftFailedNoCutouts: "00000003-0000-4000-8000-000000000106",
  // No fixture for product_missing — we just pass a UUID we never insert.
};

const MISSING_ID = "00000003-0000-4000-8000-0000000001ff";

const FIXTURE_CUTOUT_URLS = [
  "https://modelviewer.dev/assets/ShopifyModels/Chair.png",
  "https://modelviewer.dev/assets/ShopifyModels/Mixer.png",
];

const supabase = createServiceRoleClient();

let pass = 0;
let fail = 0;

function assert(cond: boolean, label: string, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${detail ? `  — ${detail}` : ""}`);
  }
}

async function cleanupFixtures() {
  const ids = [...Object.values(FIXTURES), MISSING_ID];
  await supabase.from("product_images").delete().in("product_id", ids);
  await supabase.from("products").delete().in("id", ids);
}

async function insertProduct(opts: {
  id: string;
  status: "draft" | "published";
  meshyStatus: "pending" | "generating" | "succeeded" | "failed" | null;
  meshyError?: string | null;
  glbUrl?: string | null;
  meshyAttempts?: number;
  meshyTaskId?: string | null;
}) {
  const { error } = await supabase.from("products").insert({
    id: opts.id,
    name: `smoke-m3c3-${opts.id.slice(-3)}`,
    status: opts.status,
    // Published rows need a room slug (migration 0013 trigger).
    // Cheap to always include — ignored by the draft cases.
    room_slugs: ["living_room"],
    meshy_status: opts.meshyStatus,
    meshy_error: opts.meshyError ?? null,
    glb_url: opts.glbUrl ?? null,
    meshy_attempts: opts.meshyAttempts ?? 0,
    meshy_task_id: opts.meshyTaskId ?? null,
  });
  if (error) throw new Error(`fixture ${opts.id}: ${error.message}`);
}

async function insertCutoutImages(productId: string, urls: string[]) {
  if (urls.length === 0) return;
  const rows = urls.map((url, i) => ({
    id: crypto.randomUUID(),
    product_id: productId,
    raw_image_url: `${productId}/raw-${i}.jpg`,
    cutout_image_url: url,
    state: "cutout_approved" as const,
    is_primary: i === 0,
    sort_order: i,
  }));
  const { error } = await supabase.from("product_images").insert(rows);
  if (error) throw new Error(`fixture images ${productId}: ${error.message}`);
}

async function readRow(id: string) {
  const { data } = await supabase
    .from("products")
    .select("status, meshy_status, meshy_error, meshy_attempts, meshy_task_id, glb_url")
    .eq("id", id)
    .maybeSingle();
  return data;
}

async function main() {
  console.log("\n=== Milestone 3 · Commit 3 smoke ===\n");

  console.log("→ pre-clean any leftover fixture rows");
  await cleanupFixtures();

  // ── Case 1: happy path ──────────────────────────────────────
  console.log("\n[1] happy path: draft + failed + 2 cutouts → retry succeeds");
  await insertProduct({
    id: FIXTURES.happy,
    status: "draft",
    meshyStatus: "failed",
    meshyError: "previous run died: connection reset",
    meshyAttempts: 2,
  });
  await insertCutoutImages(FIXTURES.happy, FIXTURE_CUTOUT_URLS);
  {
    const r = await retryMeshyForProductCore(FIXTURES.happy);
    assert(r.ok, "retry ok=true", r.ok ? undefined : `${r.code}: ${r.error}`);
    if (r.ok) {
      assert(typeof r.taskId === "string" && r.taskId.length > 0, "taskId stamped");
    }
    const row = await readRow(FIXTURES.happy);
    assert(
      row?.meshy_status === "generating",
      "meshy_status flipped to 'generating'",
      String(row?.meshy_status),
    );
    assert(
      typeof row?.meshy_task_id === "string" && row.meshy_task_id.length > 0,
      "meshy_task_id stamped fresh",
      String(row?.meshy_task_id),
    );
    assert(
      row?.meshy_attempts === 0,
      "meshy_attempts reset to 0",
      String(row?.meshy_attempts),
    );
    assert(row?.meshy_error === null, "meshy_error cleared", String(row?.meshy_error));
    assert(row?.status === "draft", "product status held at 'draft'", String(row?.status));
  }

  // ── Case 2: wrong_meshy_status (null) ───────────────────────
  console.log("\n[2] draft + meshy_status=null → refused, row unchanged");
  await insertProduct({
    id: FIXTURES.draftNull,
    status: "draft",
    meshyStatus: null,
  });
  {
    const r = await retryMeshyForProductCore(FIXTURES.draftNull);
    assert(!r.ok, "retry refused");
    assert(
      !r.ok && r.code === "wrong_meshy_status",
      "code = wrong_meshy_status",
      !r.ok ? r.code : undefined,
    );
    const row = await readRow(FIXTURES.draftNull);
    assert(row?.meshy_status === null, "meshy_status untouched (still null)");
    assert(row?.meshy_task_id === null, "meshy_task_id untouched");
  }

  // ── Case 3: wrong_meshy_status (succeeded) ──────────────────
  console.log("\n[3] draft + meshy_status=succeeded → refused, row unchanged");
  await insertProduct({
    id: FIXTURES.draftSucceeded,
    status: "draft",
    meshyStatus: "succeeded",
    glbUrl: null, // contrived: succeeded but no GLB. Won't happen in practice but exercises the gate ordering.
  });
  {
    const r = await retryMeshyForProductCore(FIXTURES.draftSucceeded);
    assert(!r.ok, "retry refused");
    assert(
      !r.ok && r.code === "wrong_meshy_status",
      "code = wrong_meshy_status",
      !r.ok ? r.code : undefined,
    );
    const row = await readRow(FIXTURES.draftSucceeded);
    assert(row?.meshy_status === "succeeded", "meshy_status untouched");
  }

  // ── Case 4: wrong_status (published) ────────────────────────
  console.log("\n[4] published + meshy_status=failed → refused (iron rule)");
  await insertProduct({
    id: FIXTURES.publishedFailed,
    status: "published",
    meshyStatus: "failed",
    meshyError: "old failure",
    glbUrl: "https://example.com/manual-upload.glb", // published needs a GLB
  });
  {
    const r = await retryMeshyForProductCore(FIXTURES.publishedFailed);
    assert(!r.ok, "retry refused");
    // already_has_glb is checked BEFORE wrong_status (we want the
    // most specific reason). For this fixture both apply; assert
    // we got one of the two and that the row is unchanged.
    assert(
      !r.ok && (r.code === "already_has_glb" || r.code === "wrong_status"),
      "code = already_has_glb (preferred) or wrong_status",
      !r.ok ? r.code : undefined,
    );
    const row = await readRow(FIXTURES.publishedFailed);
    assert(row?.status === "published", "product still 'published'");
    assert(row?.meshy_status === "failed", "meshy_status untouched");
  }

  // ── Case 5: already_has_glb ─────────────────────────────────
  console.log("\n[5] draft + failed + glb_url set → refused (Meshy never overwrites GLB)");
  await insertProduct({
    id: FIXTURES.draftFailedHasGlb,
    status: "draft",
    meshyStatus: "failed",
    glbUrl: "https://example.com/somehow-already-here.glb",
  });
  await insertCutoutImages(FIXTURES.draftFailedHasGlb, FIXTURE_CUTOUT_URLS);
  {
    const r = await retryMeshyForProductCore(FIXTURES.draftFailedHasGlb);
    assert(!r.ok, "retry refused");
    assert(
      !r.ok && r.code === "already_has_glb",
      "code = already_has_glb",
      !r.ok ? r.code : undefined,
    );
    const row = await readRow(FIXTURES.draftFailedHasGlb);
    assert(row?.meshy_status === "failed", "meshy_status untouched (still failed)");
  }

  // ── Case 6: no_cutouts on retry — banner-lie prevention ─────
  console.log("\n[6] draft + failed + 0 cutouts → retry blocks, row stamped back to 'failed'");
  await insertProduct({
    id: FIXTURES.draftFailedNoCutouts,
    status: "draft",
    meshyStatus: "failed",
    meshyError: "previous: bad images",
    meshyAttempts: 1,
  });
  // No cutouts inserted — retry will pass the gate, reset to
  // 'pending', then kickOff will refuse with no_cutouts.
  {
    const r = await retryMeshyForProductCore(FIXTURES.draftFailedNoCutouts);
    assert(!r.ok, "retry refused");
    assert(
      !r.ok && r.code === "no_cutouts",
      "code = no_cutouts (forwarded from kickOff)",
      !r.ok ? r.code : undefined,
    );
    const row = await readRow(FIXTURES.draftFailedNoCutouts);
    assert(
      row?.meshy_status === "failed",
      "meshy_status stamped BACK to 'failed' (not left at 'pending')",
      String(row?.meshy_status),
    );
    assert(
      typeof row?.meshy_error === "string" && row.meshy_error.includes("no_cutouts"),
      "meshy_error explains the retry block",
      row?.meshy_error ?? "(null)",
    );
    assert(row?.meshy_task_id === null, "meshy_task_id cleared by reset");
  }

  // ── Case 7: product_missing ─────────────────────────────────
  console.log("\n[7] product_missing → refused");
  {
    const r = await retryMeshyForProductCore(MISSING_ID);
    assert(!r.ok, "retry refused");
    assert(
      !r.ok && r.code === "product_missing",
      "code = product_missing",
      !r.ok ? r.code : undefined,
    );
  }

  console.log("\n→ cleanup fixtures");
  await cleanupFixtures();

  console.log(`\n=== smoke result: ${pass} pass / ${fail} fail ===\n`);
  if (fail > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error("\n!! smoke crashed:", err);
  try {
    await cleanupFixtures();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
