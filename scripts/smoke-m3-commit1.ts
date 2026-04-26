/**
 * Phase A · Milestone 3 · Commit 1 smoke
 *
 * Validates `kickOffMeshyForProduct(productId)` against fresh fixture
 * rows in the live dev DB. NO real Meshy money spent — this script
 * forces MESHY_API_KEY to Meshy's public test-mode value
 * `msy_dummy_api_key_for_test_mode_12345678`, which makes Meshy return
 * a fake task without billing.
 *
 * Cases exercised:
 *   1. no_cutouts        — product with 0 cutout_approved images
 *   2. already_has_glb   — product with glb_url set (manual upload)
 *   3. already_in_flight — product with meshy_status='generating'
 *   4. meshy_not_configured — MESHY_API_KEY blanked
 *   5. happy path        — product with 2 cutouts, test-mode key
 *      → expects: ok=true, taskId returned, DB row reads
 *        meshy_task_id=<id>, meshy_status='generating',
 *        meshy_attempts=0, meshy_error=null
 *
 * Cleanup: deletes all fixture products + their image rows.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/smoke-m3-commit1.ts
 *
 * Exit code 0 = all asserts passed; 1 = any assert failed.
 */
import { createServiceRoleClient } from "../src/lib/supabase/service";
import { kickOffMeshyForProduct } from "../src/lib/meshy-kickoff";

// Force Meshy test-mode. Even if the user has a real key in .env.local,
// THIS script uses test-mode unconditionally. Real-money testing is for
// commit 6 onwards (per Jym's "commit 1-5 用 mock, 不烧真 credit" rule).
const TEST_KEY = "msy_dummy_api_key_for_test_mode_12345678";
process.env.MESHY_API_KEY = TEST_KEY;

// Fixture product ids — namespaced so they don't collide with seed
// products (those use 00000000-0000-4000-8000-00000000000X). The
// `00000003` block (3 = M3) makes a leftover row from a crashed run
// obviously a smoke artifact.
const FIXTURES = {
  noCutouts: "00000003-0000-4000-8000-000000000001",
  hasGlb: "00000003-0000-4000-8000-000000000002",
  inFlight: "00000003-0000-4000-8000-000000000003",
  happy: "00000003-0000-4000-8000-000000000004",
  notConfigured: "00000003-0000-4000-8000-000000000005",
};

// Two publicly-reachable image URLs. Meshy's test mode doesn't
// actually download these (it returns canned responses), but we use
// real URLs so the same script could be re-pointed at the live API
// later without changes. Source: modelviewer.dev assets — same CDN
// the seed products already reference.
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
  const ids = Object.values(FIXTURES);
  // image rows have no FK ON DELETE CASCADE wired to products in
  // this codebase (verified pre-flight; see migration 0003 STEP 4),
  // so delete them explicitly first.
  await supabase.from("product_images").delete().in("product_id", ids);
  await supabase.from("products").delete().in("id", ids);
  // api_usage rows from earlier runs would dangle (no FK either) —
  // leave them. They're audit history; smoke runs accrete a few
  // $0.25 entries per run but the rows themselves are harmless.
}

async function insertFixtureProduct(opts: {
  id: string;
  name: string;
  glbUrl?: string | null;
  meshyStatus?: "generating" | null;
  meshyTaskId?: string | null;
}) {
  const { error } = await supabase.from("products").insert({
    id: opts.id,
    name: opts.name,
    status: "draft",
    glb_url: opts.glbUrl ?? null,
    meshy_status: opts.meshyStatus ?? null,
    meshy_task_id: opts.meshyTaskId ?? null,
  });
  if (error) throw new Error(`fixture insert ${opts.id}: ${error.message}`);
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

async function main() {
  console.log("\n=== Milestone 3 · Commit 1 smoke ===\n");

  // Tabula rasa first (re-runs after a crashed earlier attempt are
  // common during dev — defensive).
  console.log("→ pre-clean any leftover fixture rows");
  await cleanupFixtures();

  // ── Case 1: no_cutouts ──────────────────────────────────────
  console.log("\n[1] no_cutouts (0 cutout_approved images)");
  await insertFixtureProduct({ id: FIXTURES.noCutouts, name: "smoke: no cutouts" });
  {
    const r = await kickOffMeshyForProduct(FIXTURES.noCutouts);
    assert(!r.ok, "kick-off rejected", r.ok ? "got ok=true" : undefined);
    assert(
      !r.ok && r.error === "no_cutouts",
      "error code = no_cutouts",
      !r.ok ? r.error : undefined,
    );
  }

  // ── Case 2: already_has_glb ─────────────────────────────────
  console.log("\n[2] already_has_glb (glb_url pre-set)");
  await insertFixtureProduct({
    id: FIXTURES.hasGlb,
    name: "smoke: has glb",
    glbUrl: "https://example.com/fake.glb",
  });
  await insertCutoutImages(FIXTURES.hasGlb, FIXTURE_CUTOUT_URLS);
  {
    const r = await kickOffMeshyForProduct(FIXTURES.hasGlb);
    assert(!r.ok, "kick-off rejected");
    assert(
      !r.ok && r.error === "already_has_glb",
      "error code = already_has_glb",
      !r.ok ? r.error : undefined,
    );
  }

  // ── Case 3: already_in_flight ───────────────────────────────
  console.log("\n[3] already_in_flight (meshy_status=generating)");
  await insertFixtureProduct({
    id: FIXTURES.inFlight,
    name: "smoke: in flight",
    meshyStatus: "generating",
    meshyTaskId: "stub-task-id",
  });
  await insertCutoutImages(FIXTURES.inFlight, FIXTURE_CUTOUT_URLS);
  {
    const r = await kickOffMeshyForProduct(FIXTURES.inFlight);
    assert(!r.ok, "kick-off rejected");
    assert(
      !r.ok && r.error === "already_in_flight",
      "error code = already_in_flight",
      !r.ok ? r.error : undefined,
    );
  }

  // ── Case 4: meshy_not_configured ────────────────────────────
  console.log("\n[4] meshy_not_configured (MESHY_API_KEY blanked)");
  await insertFixtureProduct({
    id: FIXTURES.notConfigured,
    name: "smoke: no key",
  });
  await insertCutoutImages(FIXTURES.notConfigured, FIXTURE_CUTOUT_URLS);
  {
    const saved = process.env.MESHY_API_KEY;
    delete process.env.MESHY_API_KEY;
    const r = await kickOffMeshyForProduct(FIXTURES.notConfigured);
    process.env.MESHY_API_KEY = saved;
    assert(!r.ok, "kick-off rejected");
    assert(
      !r.ok && r.error === "meshy_not_configured",
      "error code = meshy_not_configured",
      !r.ok ? r.error : undefined,
    );
  }

  // ── Case 5: happy path (test-mode key) ──────────────────────
  console.log("\n[5] happy path (test-mode Meshy)");
  await insertFixtureProduct({ id: FIXTURES.happy, name: "smoke: happy" });
  await insertCutoutImages(FIXTURES.happy, FIXTURE_CUTOUT_URLS);
  {
    const r = await kickOffMeshyForProduct(FIXTURES.happy);
    assert(r.ok, "kick-off ok=true", r.ok ? undefined : `${r.error}: ${r.detail ?? ""}`);
    if (r.ok) {
      assert(typeof r.taskId === "string" && r.taskId.length > 0, "taskId is non-empty string");
      assert(r.imageCount === 2, "imageCount = 2", `got ${r.imageCount}`);
    }

    // Verify DB row was stamped correctly.
    const { data: row } = await supabase
      .from("products")
      .select("meshy_task_id, meshy_status, meshy_attempts, meshy_error, status")
      .eq("id", FIXTURES.happy)
      .single();
    assert(
      row?.meshy_status === "generating",
      "DB meshy_status = 'generating'",
      `got ${row?.meshy_status}`,
    );
    assert(
      typeof row?.meshy_task_id === "string" && row.meshy_task_id.length > 0,
      "DB meshy_task_id stamped",
      String(row?.meshy_task_id),
    );
    assert(row?.meshy_attempts === 0, "DB meshy_attempts = 0", String(row?.meshy_attempts));
    assert(row?.meshy_error === null, "DB meshy_error = null", String(row?.meshy_error));
    assert(row?.status === "draft", "product status still 'draft' (held back)", String(row?.status));
  }

  // ── cleanup ─────────────────────────────────────────────────
  console.log("\n→ cleanup fixtures");
  await cleanupFixtures();

  console.log(`\n=== smoke result: ${pass} pass / ${fail} fail ===\n`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("\n!! smoke crashed:", err);
  cleanupFixtures().finally(() => process.exit(1));
});
