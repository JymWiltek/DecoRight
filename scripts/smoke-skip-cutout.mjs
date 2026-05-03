#!/usr/bin/env node
/**
 * Wave B · skip-cutout smoke (mig 0027).
 *
 * Verifies the three scenarios from Step 1 of the plan against a real
 * Supabase project:
 *
 *   [1] Skip flow      — raw photo → "Skip — already clean" → row
 *                        lands at cutout_approved + skip_cutout=true
 *                        + is_primary=true. sync_primary_thumbnail
 *                        trigger copies the URL into thumbnail_url.
 *                        Publish gate now counts ≥1 cutout_approved
 *                        so the cutouts gate passes.
 *
 *   [2] Existing rembg — control row inserted directly at
 *                        cutout_approved (skip_cutout=false default,
 *                        rembg_provider set). Confirms the gate count
 *                        treats real-rembg and skipped rows uniformly.
 *
 *   [3] Mixed product  — one rembg row + one skip row on the SAME
 *                        product. Both visible to the storefront's
 *                        anon RLS read. Primary is the first-by-
 *                        created_at row (matches existing pipeline
 *                        convention).
 *
 * The script DOES NOT call markImageSkipCutout itself (it's a server
 * action and lives behind admin auth). It exercises the EXACT same
 * sequence — copyRawToCutouts equivalent + the UPDATE patch — so any
 * shape mismatch (column missing, trigger rule changed, RLS broken)
 * surfaces here.
 *
 * Run with:
 *   node --env-file=.env.local scripts/smoke-skip-cutout.mjs
 *
 * Side-effect: creates 2 test products ("Skip Smoke A/B"). Leaves
 * them in the DB so Jym can click through /admin to see the result.
 * Re-running creates fresh UUIDs each time.
 */

import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const SB_URL = process.env.NEXT_PUBLIC_APP_SUPABASE_URL;
const SR_KEY = process.env.APP_SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_APP_SUPABASE_ANON_KEY;

if (!SB_URL || !SR_KEY || !ANON_KEY) {
  console.error(
    "Missing env. Run with: node --env-file=.env.local scripts/smoke-skip-cutout.mjs",
  );
  process.exit(1);
}

const sr = createClient(SB_URL, SR_KEY, { auth: { persistSession: false } });
const anon = createClient(SB_URL, ANON_KEY, { auth: { persistSession: false } });

// CC BY-SA 4.0 image (same source as e2e-verify-pipeline.mjs).
const CC0_IMAGE_URL =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b6/Chicago_Faucet_Co_faucet.jpg/330px-Chicago_Faucet_Co_faucet.jpg";

function log(stage, data) {
  console.log(`[${stage}]`, data ?? "");
}

function bail(msg, extra) {
  console.error(`\n❌ ${msg}`);
  if (extra !== undefined) console.error(extra);
  process.exit(2);
}

// Mirror of src/lib/storage.ts copyRawToCutouts. We keep the script
// self-contained (no path-alias imports) but exercise the SAME bytes-
// down + bytes-up sequence so any Supabase Storage misconfiguration
// surfaces here.
async function copyRawToCutouts(rawPath, productId, imageId) {
  const dl = await sr.storage.from("raw-images").download(rawPath);
  if (dl.error) throw dl.error;
  const dotIdx = rawPath.lastIndexOf(".");
  const ext = dotIdx >= 0 ? rawPath.slice(dotIdx + 1).toLowerCase() : "jpg";
  const contentType =
    ext === "png"
      ? "image/png"
      : ext === "webp"
        ? "image/webp"
        : ext === "gif"
          ? "image/gif"
          : "image/jpeg";
  const dstPath = `${productId}/${imageId}.${ext}`;
  const bytes = await dl.data.arrayBuffer();
  const up = await sr.storage
    .from("cutouts")
    .upload(dstPath, new Blob([bytes], { type: contentType }), {
      upsert: true,
      contentType,
      cacheControl: "31536000",
    });
  if (up.error) throw up.error;
  const { data } = sr.storage.from("cutouts").getPublicUrl(dstPath);
  return `${data.publicUrl}?v=${Date.now()}`;
}

async function fetchBytes() {
  const res = await fetch(CC0_IMAGE_URL, {
    headers: { "User-Agent": "decoright-smoke-skip-cutout" },
  });
  if (!res.ok) throw new Error(`CC0 fetch failed: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function uploadRaw(productId, imageId, bytes) {
  const path = `${productId}/${imageId}.jpg`;
  const r = await sr.storage
    .from("raw-images")
    .upload(path, bytes, { contentType: "image/jpeg", upsert: true });
  if (r.error) throw r.error;
  return path;
}

async function makeProduct(name) {
  const id = crypto.randomUUID();
  const { error } = await sr.from("products").insert({
    id,
    name,
    item_type: "faucet",
    status: "draft",
    // Three other gate facts pre-satisfied so the publish gate's
    // ONLY pending blocker is cutouts. That isolates what we're
    // actually testing here.
    room_slugs: ["kitchen"],
    glb_url: "https://example.com/fake.glb",
    glb_size_kb: 1,
    styles: [],
    colors: [],
    materials: [],
    ai_filled_fields: [],
  });
  if (error) throw new Error(`product insert: ${error.message}`);
  return id;
}

async function loadGateFacts(productId) {
  // Mirror of loadPublishGateFacts in actions.ts:466-487.
  const [rowRes, cutCountRes] = await Promise.all([
    sr
      .from("products")
      .select("room_slugs, glb_url")
      .eq("id", productId)
      .maybeSingle(),
    sr
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

function checkPublishGates(input) {
  // Mirror of src/lib/publish-gates.ts.
  if (input.rooms.length === 0) return { ok: false, reason: "rooms" };
  if (input.cutoutApprovedCount < 1) return { ok: false, reason: "cutouts" };
  if (!input.glbUrl) return { ok: false, reason: "glb" };
  return { ok: true };
}

async function main() {
  log("fetch", `GET ${CC0_IMAGE_URL}`);
  const bytes = await fetchBytes();
  log("fetch", `${bytes.byteLength} bytes`);

  // ─── Scenario 1: skip flow ──────────────────────────────────
  console.log("\n=== Scenario 1 · Skip flow ===");
  const pid1 = await makeProduct("Skip Smoke A");
  const iid1 = crypto.randomUUID();
  log("product", pid1);

  const { error: ins1 } = await sr.from("product_images").insert({
    id: iid1,
    product_id: pid1,
    state: "raw",
  });
  if (ins1) bail("image insert", ins1.message);

  const rawPath1 = await uploadRaw(pid1, iid1, bytes);
  const { error: link1 } = await sr
    .from("product_images")
    .update({ raw_image_url: rawPath1 })
    .eq("id", iid1);
  if (link1) bail("raw link", link1.message);

  // Pre-skip gate: should FAIL on cutouts (no approved rows yet).
  const pre1 = checkPublishGates(await loadGateFacts(pid1));
  log("pre_skip_gate", JSON.stringify(pre1));
  if (pre1.ok || pre1.reason !== "cutouts") {
    bail(`expected pre-skip gate to fail on 'cutouts', got ${JSON.stringify(pre1)}`);
  }

  // Run the same sequence markImageSkipCutout runs.
  const cutoutUrl = await copyRawToCutouts(rawPath1, pid1, iid1);
  log("copy_raw_to_cutouts", cutoutUrl);

  // primary check parallel — mirror of the action.
  const { data: existingPrim } = await sr
    .from("product_images")
    .select("id")
    .eq("product_id", pid1)
    .eq("is_primary", true)
    .maybeSingle();

  const patch = {
    state: "cutout_approved",
    cutout_image_url: cutoutUrl,
    skip_cutout: true,
    rembg_provider: null,
    rembg_cost_usd: null,
    last_error_kind: null,
  };
  if (!existingPrim) patch.is_primary = true;

  const { error: upd1 } = await sr
    .from("product_images")
    .update(patch)
    .eq("id", iid1)
    .eq("product_id", pid1);
  if (upd1) bail("skip update", upd1.message);

  // Verify row state.
  const { data: row1 } = await sr
    .from("product_images")
    .select(
      "state, skip_cutout, is_primary, cutout_image_url, rembg_provider, rembg_cost_usd",
    )
    .eq("id", iid1)
    .single();
  log("row", JSON.stringify(row1));
  if (
    row1.state !== "cutout_approved" ||
    row1.skip_cutout !== true ||
    row1.is_primary !== true ||
    !row1.cutout_image_url ||
    row1.rembg_provider !== null ||
    row1.rembg_cost_usd !== null
  ) {
    bail("skip row mismatch", row1);
  }

  // Verify trigger fired → products.thumbnail_url.
  const { data: prod1 } = await sr
    .from("products")
    .select("thumbnail_url")
    .eq("id", pid1)
    .single();
  log("thumb_synced", prod1.thumbnail_url);
  if (
    !prod1.thumbnail_url ||
    !prod1.thumbnail_url.startsWith(cutoutUrl.split("?")[0])
  ) {
    bail(
      `trigger did not sync thumbnail_url; expected prefix=${cutoutUrl.split("?")[0]} got=${prod1.thumbnail_url}`,
    );
  }

  // Verify anon RLS lets a public read through.
  const { data: anonRow1, error: anonErr1 } = await anon
    .from("product_images")
    .select("id, state, skip_cutout")
    .eq("id", iid1)
    .single();
  log("anon_rls", JSON.stringify(anonRow1) + (anonErr1 ? ` err=${anonErr1.message}` : ""));
  if (!anonRow1 || anonRow1.id !== iid1) {
    bail("anon RLS did not return skip_cutout row", anonErr1 ?? anonRow1);
  }

  // Verify publish gate now passes.
  const post1 = checkPublishGates(await loadGateFacts(pid1));
  log("post_skip_gate", JSON.stringify(post1));
  if (!post1.ok) {
    bail(`expected post-skip gate ok=true, got ${JSON.stringify(post1)}`);
  }

  console.log("✅ Scenario 1 passed — skip flow works end-to-end.");

  // ─── Scenario 2: existing rembg path unchanged ──────────────
  console.log("\n=== Scenario 2 · Existing rembg path ===");
  const pid2 = await makeProduct("Skip Smoke B");
  const iid2 = crypto.randomUUID();
  log("product", pid2);

  // Stage a "real rembg" approved row directly. We don't actually
  // call rembg — just write the terminal state that runRembgForImage
  // would produce on a successful run.
  const rawPath2 = await uploadRaw(pid2, iid2, bytes);
  const cutoutPath2 = `${pid2}/${iid2}.png`;
  const up2 = await sr.storage
    .from("cutouts")
    .upload(cutoutPath2, bytes, { contentType: "image/png", upsert: true });
  if (up2.error) bail("cutout upload (s2)", up2.error.message);
  const cutoutUrl2 = `${sr.storage.from("cutouts").getPublicUrl(cutoutPath2).data.publicUrl}?v=${Date.now()}`;

  const { error: ins2 } = await sr.from("product_images").insert({
    id: iid2,
    product_id: pid2,
    state: "cutout_approved",
    raw_image_url: rawPath2,
    cutout_image_url: cutoutUrl2,
    is_primary: true,
    rembg_provider: "replicate_rembg",
    rembg_cost_usd: 0.002,
    // skip_cutout omitted — should default to false.
  });
  if (ins2) bail("rembg row insert", ins2.message);

  const { data: row2 } = await sr
    .from("product_images")
    .select("state, skip_cutout, is_primary, rembg_provider, rembg_cost_usd")
    .eq("id", iid2)
    .single();
  log("row", JSON.stringify(row2));
  if (
    row2.state !== "cutout_approved" ||
    row2.skip_cutout !== false ||
    row2.is_primary !== true ||
    row2.rembg_provider !== "replicate_rembg" ||
    Number(row2.rembg_cost_usd) !== 0.002
  ) {
    bail("rembg row state regressed", row2);
  }

  const gate2 = checkPublishGates(await loadGateFacts(pid2));
  log("gate", JSON.stringify(gate2));
  if (!gate2.ok) bail("rembg-only product blocked at publish", gate2);

  console.log(
    "✅ Scenario 2 passed — existing rembg path still produces a publishable row, skip_cutout defaults false.",
  );

  // ─── Scenario 3: mixed (rembg + skip on same product) ────────
  console.log("\n=== Scenario 3 · Mixed product ===");
  const pid3 = await makeProduct("Skip Smoke C — mixed");
  log("product", pid3);

  // Image A: real-rembg path, inserted FIRST so its created_at is
  // earlier — it should win primary.
  const iidA = crypto.randomUUID();
  const rawPathA = await uploadRaw(pid3, iidA, bytes);
  const cutoutPathA = `${pid3}/${iidA}.png`;
  const upA = await sr.storage
    .from("cutouts")
    .upload(cutoutPathA, bytes, { contentType: "image/png", upsert: true });
  if (upA.error) bail("cutout upload (s3-A)", upA.error.message);
  const cutoutUrlA = `${sr.storage.from("cutouts").getPublicUrl(cutoutPathA).data.publicUrl}?v=${Date.now()}`;
  const { error: insA } = await sr.from("product_images").insert({
    id: iidA,
    product_id: pid3,
    state: "cutout_approved",
    raw_image_url: rawPathA,
    cutout_image_url: cutoutUrlA,
    is_primary: true,
    rembg_provider: "replicate_rembg",
    rembg_cost_usd: 0.002,
  });
  if (insA) bail("mixed rembg insert", insA.message);
  // Sleep ~50 ms so created_at orders A < B reliably (Postgres
  // timestamp resolution is usually microseconds, but cheap insurance).
  await new Promise((r) => setTimeout(r, 60));

  // Image B: skip flow. Insert raw, link path, run copy, UPDATE.
  const iidB = crypto.randomUUID();
  const { error: insBraw } = await sr.from("product_images").insert({
    id: iidB,
    product_id: pid3,
    state: "raw",
  });
  if (insBraw) bail("mixed raw insert", insBraw.message);
  const rawPathB = await uploadRaw(pid3, iidB, bytes);
  await sr
    .from("product_images")
    .update({ raw_image_url: rawPathB })
    .eq("id", iidB);

  const cutoutUrlB = await copyRawToCutouts(rawPathB, pid3, iidB);

  const { data: existingPrimB } = await sr
    .from("product_images")
    .select("id")
    .eq("product_id", pid3)
    .eq("is_primary", true)
    .maybeSingle();
  // existingPrimB should be image A — so the action would NOT set
  // is_primary on B. This is the convention test.
  if (!existingPrimB || existingPrimB.id !== iidA) {
    bail(
      `expected existing primary = ${iidA} (rembg row, inserted first), got ${existingPrimB?.id ?? "none"}`,
    );
  }
  const patchB = {
    state: "cutout_approved",
    cutout_image_url: cutoutUrlB,
    skip_cutout: true,
    rembg_provider: null,
    rembg_cost_usd: null,
    last_error_kind: null,
    // is_primary intentionally not set — A keeps it.
  };
  const { error: updB } = await sr
    .from("product_images")
    .update(patchB)
    .eq("id", iidB);
  if (updB) bail("mixed skip update", updB.message);

  // Gate count should now be 2.
  const gate3 = await loadGateFacts(pid3);
  log("gate_facts", JSON.stringify(gate3));
  if (gate3.cutoutApprovedCount !== 2) {
    bail(`expected cutoutApprovedCount=2, got ${gate3.cutoutApprovedCount}`);
  }

  // Anon RLS gallery query (mirrors /product/[id]/page.tsx but via
  // ANON to prove RLS is honored — service-role would bypass it).
  const { data: gallery } = await anon
    .from("product_images")
    .select("id, is_primary, skip_cutout, state")
    .eq("product_id", pid3)
    .eq("state", "cutout_approved")
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });
  log("anon_gallery", JSON.stringify(gallery));
  if (!gallery || gallery.length !== 2) {
    bail(`expected anon gallery to return 2 rows, got ${gallery?.length}`);
  }
  if (gallery[0].id !== iidA || !gallery[0].is_primary) {
    bail(`expected primary row first = ${iidA}, got ${JSON.stringify(gallery[0])}`);
  }
  const skipRow = gallery.find((r) => r.id === iidB);
  if (!skipRow || !skipRow.skip_cutout) {
    bail(`expected skip row in gallery with skip_cutout=true, got ${JSON.stringify(skipRow)}`);
  }

  console.log(
    "✅ Scenario 3 passed — mixed gallery returns both rows, primary held by first-by-created_at (rembg row).",
  );

  console.log("\n────────────────────────────────────────");
  console.log("ALL 3 SCENARIOS PASSED.");
  console.log("Test products (left in DB for inspection):");
  console.log("  Scenario 1 (skip-only):  /admin/products/" + pid1 + "/edit");
  console.log("  Scenario 2 (rembg-only): /admin/products/" + pid2 + "/edit");
  console.log("  Scenario 3 (mixed):      /admin/products/" + pid3 + "/edit");
}

main().catch((err) => {
  console.error("smoke FAILED:", err);
  process.exit(1);
});
