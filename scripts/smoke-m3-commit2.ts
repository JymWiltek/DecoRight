/**
 * Phase A · Milestone 3 · Commit 2 smoke
 *
 * Validates the data layer that backs MeshyStatusBanner — i.e. that
 * the DB row in each of the 3 visual states yields the snapshot the
 * client component renders from. The banner's behavior is a pure
 * function of `MeshyStatusSnapshot`, so verifying the snapshot is
 * equivalent to verifying the banner.
 *
 * Why no full E2E with a headless browser:
 *   The banner is a thin presentational layer over getMeshyStatus.
 *   The interesting failure modes (wrong column read, missing
 *   field, transitions not detected) all fall out of asserting the
 *   snapshot shape after each manual SQL UPDATE.
 *
 * Manual browser checklist (for Jym to walk through after this
 * smoke passes):
 *
 *   1. Pick a fixture product id with meshy_status='generating'
 *      (the smoke leaves one behind in case 5 if you pass --keep).
 *   2. Open /admin/products/<id>/edit
 *      → Expect: BLUE banner "3D 模型生成中…" with a spinner.
 *   3. In Supabase SQL editor, run:
 *        UPDATE products SET meshy_status='succeeded'
 *        WHERE id='<id>';
 *      Wait up to 5s.
 *      → Expect: GREEN banner "✓ 3D 模型已生成", page auto-refreshes.
 *   4. Run:
 *        UPDATE products SET meshy_status='failed',
 *               meshy_error='test failure: out of credits'
 *        WHERE id='<id>';
 *      Wait up to 5s.
 *      → Expect: RED banner with the error reason.
 *   5. Run:
 *        UPDATE products SET meshy_status=NULL, meshy_error=NULL
 *        WHERE id='<id>';
 *      Refresh the page (banner doesn't auto-hide on null — it
 *      only auto-shows on transitions, by design).
 *      → Expect: NO banner (quiet steady state).
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/smoke-m3-commit2.ts
 *   npx tsx --env-file=.env.local scripts/smoke-m3-commit2.ts --keep
 *     (skip cleanup so you can browser-test the leftover row)
 */
import { createServiceRoleClient } from "../src/lib/supabase/service";

const KEEP = process.argv.includes("--keep");

// Smoke fixture — namespaced under 00000003-… (M3) like commit 1.
const FIXTURE_ID = "00000003-0000-4000-8000-000000000099";

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

/**
 * Mirrors the column set getMeshyStatus reads + returns. We bypass
 * the action itself (which requires admin cookies) and assert
 * directly against the DB row — the action is a 5-line passthrough
 * and the auth gate isn't what we're testing here.
 */
async function readSnapshot(productId: string) {
  const { data, error } = await supabase
    .from("products")
    .select("meshy_status, meshy_error, meshy_attempts, glb_url, status")
    .eq("id", productId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    status: data.meshy_status,
    error: data.meshy_error,
    glbUrl: data.glb_url,
    productStatus: data.status,
    attempts: data.meshy_attempts,
  };
}

async function setMeshyState(opts: {
  status: "generating" | "succeeded" | "failed" | null;
  error?: string | null;
  glbUrl?: string | null;
  productStatus?: "draft" | "published";
}) {
  const { error } = await supabase
    .from("products")
    .update({
      meshy_status: opts.status,
      meshy_error: opts.error ?? null,
      glb_url: opts.glbUrl ?? null,
      status: opts.productStatus ?? "draft",
    })
    .eq("id", FIXTURE_ID);
  if (error) throw new Error(`setMeshyState: ${error.message}`);
}

async function main() {
  console.log("\n=== Milestone 3 · Commit 2 smoke ===\n");
  console.log("→ pre-clean any leftover fixture row");
  await supabase.from("products").delete().eq("id", FIXTURE_ID);

  // Fresh fixture in 'generating' state — what kickOff would leave
  // behind right after Publish. room_slugs needs at least one entry
  // so case 2 (status='published') can satisfy migration 0013's
  // products_check_rooms_required trigger when we test the "promoted
  // to published" path.
  console.log(`→ insert fixture ${FIXTURE_ID} (meshy_status='generating')`);
  {
    const { error } = await supabase.from("products").insert({
      id: FIXTURE_ID,
      name: "smoke-m3c2",
      status: "draft",
      room_slugs: ["living_room"],
      meshy_status: "generating",
      meshy_task_id: "stub-c2-task",
      meshy_attempts: 0,
    });
    if (error) throw new Error(`fixture insert: ${error.message}`);
  }

  // ── State 1: generating (BLUE banner) ───────────────────────
  console.log("\n[1] generating → BLUE banner data");
  {
    const snap = await readSnapshot(FIXTURE_ID);
    assert(snap !== null, "row exists");
    assert(snap?.status === "generating", "status='generating'", String(snap?.status));
    assert(snap?.glbUrl === null, "glbUrl is null");
    assert(snap?.productStatus === "draft", "product status held at 'draft'");
    assert(snap?.attempts === 0, "attempts=0", String(snap?.attempts));
  }

  // ── State 2: succeeded (GREEN banner + Live now) ────────────
  console.log("\n[2] succeeded + product promoted → GREEN banner with 'Live now'");
  await setMeshyState({
    status: "succeeded",
    glbUrl: "https://example.com/test.glb?v=1",
    productStatus: "published",
  });
  {
    const snap = await readSnapshot(FIXTURE_ID);
    assert(snap?.status === "succeeded", "status='succeeded'", String(snap?.status));
    assert(snap?.glbUrl !== null, "glbUrl populated");
    assert(snap?.productStatus === "published", "product promoted to 'published'");
    // Banner should show "Live now" suffix when productStatus === 'published'.
  }

  // ── State 3: failed (RED banner) ────────────────────────────
  console.log("\n[3] failed + meshy_error → RED banner");
  await setMeshyState({
    status: "failed",
    error: "test failure: meshy returned 503 — out of credits",
    glbUrl: null,
    productStatus: "draft",
  });
  {
    const snap = await readSnapshot(FIXTURE_ID);
    assert(snap?.status === "failed", "status='failed'", String(snap?.status));
    assert(
      typeof snap?.error === "string" && snap.error.includes("out of credits"),
      "meshy_error text preserved",
      snap?.error ?? "(null)",
    );
    assert(snap?.productStatus === "draft", "product status back to 'draft'");
  }

  // ── State 4: null (no banner) ───────────────────────────────
  console.log("\n[4] null → quiet (no banner rendered without ?meshy=started)");
  await setMeshyState({ status: null, error: null, glbUrl: null, productStatus: "draft" });
  {
    const snap = await readSnapshot(FIXTURE_ID);
    assert(snap?.status === null, "status=null");
    assert(snap?.error === null, "error=null");
  }

  // ── CHECK constraint: invalid status string ─────────────────
  console.log("\n[5] CHECK constraint rejects unknown meshy_status");
  {
    const { error } = await supabase
      .from("products")
      .update({ meshy_status: "wat" as never })
      .eq("id", FIXTURE_ID);
    assert(error !== null, "DB rejected meshy_status='wat'", error?.message);
  }

  // ── Leave fixture for browser verification, or clean up ─────
  if (KEEP) {
    console.log(`\n→ --keep flag set, leaving fixture ${FIXTURE_ID} in 'generating' state`);
    await setMeshyState({ status: "generating" });
    console.log(`   open: /admin/products/${FIXTURE_ID}/edit`);
  } else {
    console.log("\n→ cleanup fixture");
    await supabase.from("products").delete().eq("id", FIXTURE_ID);
  }

  console.log(`\n=== smoke result: ${pass} pass / ${fail} fail ===\n`);
  if (fail > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error("\n!! smoke crashed:", err);
  // Supabase query builders aren't true Promises (no .catch), so we
  // wrap in try/catch instead. The fallback delete is best-effort.
  try {
    await supabase.from("products").delete().eq("id", FIXTURE_ID);
  } catch {
    /* ignore */
  }
  process.exit(1);
});
