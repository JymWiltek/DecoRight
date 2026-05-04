#!/usr/bin/env node
/**
 * Wipe Products · Step 1 backup.
 *
 * Pulls every row that the wipe will affect (or that we want a paper
 * trail for) into a single timestamped JSON file outside the repo,
 * so Jym can restore from it if Step 3 deletes the wrong thing.
 *
 * What's backed up:
 *   • products            — full table (DELETED in Step 3)
 *   • product_images      — full table (DELETED in Step 3)
 *   • api_usage_product   — rows where product_id IS NOT NULL OR
 *                           product_image_id IS NOT NULL. Backed up
 *                           even though Step 3 keeps these rows
 *                           (FKs are ON DELETE SET NULL, so the rows
 *                           survive but lose their product link).
 *   • storage_paths       — raw-images / cutouts / models / thumbnails
 *                           recursive object lists. Bytes are NOT
 *                           copied — these are forensic references
 *                           only. After Step 3 cleans raw-images +
 *                           cutouts, we'll be able to compare against
 *                           the saved list.
 *   • taxonomy_counts     — count(*) for every preserved table so the
 *                           Step 4 final report can prove they were
 *                           untouched.
 *
 * What's NOT backed up:
 *   • Bytes. We never download blob contents. The user explicitly
 *     said "只记路径供参考".
 *   • Schema, RLS, triggers, functions, migration history — these
 *     live in /supabase/migrations and git already tracks them.
 *   • _app_config and other settings tables — not affected by the
 *     wipe; if needed, dump them separately.
 *
 * Run with:
 *   node --env-file=.env.local scripts/backup-products-before-wipe.mjs
 *
 * Output:
 *   ~/decoright-backups/products-<ISO-stamp>.json
 */

import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SB_URL = process.env.NEXT_PUBLIC_APP_SUPABASE_URL;
const SR_KEY = process.env.APP_SUPABASE_SERVICE_ROLE_KEY;

if (!SB_URL || !SR_KEY) {
  console.error(
    "Missing env. Run with: node --env-file=.env.local scripts/backup-products-before-wipe.mjs",
  );
  process.exit(1);
}

const sr = createClient(SB_URL, SR_KEY, { auth: { persistSession: false } });

// Tables we MUST preserve. Counts go into the backup JSON so Step 4
// can prove these didn't change. Order doesn't matter — we just count.
const PRESERVED_TABLES = [
  "rooms",
  "item_types",
  "item_subtypes",
  "styles",
  "materials",
  "colors",
  "regions",
  "item_type_rooms",
  "_app_config",
];

// Buckets we forensically list. raw-images + cutouts will be wiped in
// Step 3; models + thumbnails are preserved (models holds GLB files,
// thumbnails holds room cover images). Listing all four lets Step 4
// prove the preserved buckets were untouched.
const BUCKETS = ["raw-images", "cutouts", "models", "thumbnails"];

/**
 * Page through a table 1000 rows at a time. Supabase enforces a hard
 * 1000 default limit; if any of these tables ever grows past that,
 * the unchunked select silently truncates. range() with order on the
 * primary key is the documented workaround.
 */
async function dumpAll(table, orderCol = "created_at") {
  const all = [];
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await sr
      .from(table)
      .select("*")
      .order(orderCol, { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table} dump failed: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function dumpApiUsageProductRows() {
  // OR filter syntax — Supabase needs comma-separated, no spaces.
  const all = [];
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await sr
      .from("api_usage")
      .select("*")
      .or("product_id.not.is.null,product_image_id.not.is.null")
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error)
      throw new Error(`api_usage dump failed: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function countTable(table) {
  const { count, error } = await sr
    .from(table)
    .select("*", { count: "exact", head: true });
  if (error) throw new Error(`${table} count failed: ${error.message}`);
  return count ?? 0;
}

/**
 * Recursively list a Supabase Storage bucket. The list() API only
 * returns one folder level at a time; we walk the tree manually so
 * the backup captures every leaf path.
 *
 * Returns string[] of full bucket-relative paths (e.g.
 * "<product_id>/<image_id>.jpg").
 */
async function listBucketRecursive(bucket) {
  const all = [];
  async function walk(prefix) {
    let offset = 0;
    const PAGE = 1000;
    for (;;) {
      const { data, error } = await sr.storage
        .from(bucket)
        .list(prefix, { limit: PAGE, offset });
      if (error)
        throw new Error(`bucket ${bucket} list ${prefix} failed: ${error.message}`);
      if (!data || data.length === 0) break;
      for (const ent of data) {
        // Folders come back with id=null; files have id set.
        if (ent.id === null) {
          await walk(prefix ? `${prefix}/${ent.name}` : ent.name);
        } else {
          all.push(prefix ? `${prefix}/${ent.name}` : ent.name);
        }
      }
      if (data.length < PAGE) break;
      offset += PAGE;
    }
  }
  await walk("");
  return all;
}

(async () => {
  const startedAt = new Date();
  const stamp = startedAt
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace(/-(\d{3})Z$/, "-$1Z");

  console.log(`[backup] start ${startedAt.toISOString()}`);
  console.log(`[backup] supabase url: ${SB_URL}`);

  // 1. Tables to be wiped.
  console.log("[backup] dumping products …");
  const products = await dumpAll("products");
  console.log(`[backup]   products = ${products.length}`);

  console.log("[backup] dumping product_images …");
  const productImages = await dumpAll("product_images");
  console.log(`[backup]   product_images = ${productImages.length}`);

  // 2. api_usage product-linked rows (kept post-wipe but FK becomes null).
  console.log("[backup] dumping api_usage product-linked rows …");
  const apiUsage = await dumpApiUsageProductRows();
  console.log(`[backup]   api_usage(product-linked) = ${apiUsage.length}`);

  // 3. Preserved tables: count only (proof for Step 4).
  console.log("[backup] counting preserved tables …");
  const preservedCounts = {};
  for (const t of PRESERVED_TABLES) {
    try {
      preservedCounts[t] = await countTable(t);
      console.log(`[backup]   ${t} = ${preservedCounts[t]}`);
    } catch (e) {
      // _app_config is the only table that might not exist in every
      // env. Log + continue rather than aborting the whole backup.
      preservedCounts[t] = { error: String(e?.message ?? e) };
      console.warn(`[backup]   ${t} → ${preservedCounts[t].error}`);
    }
  }

  // 4. Storage bucket object lists (paths only, no bytes).
  console.log("[backup] listing storage buckets …");
  const storagePaths = {};
  for (const b of BUCKETS) {
    const paths = await listBucketRecursive(b);
    storagePaths[b] = {
      count: paths.length,
      paths,
    };
    console.log(`[backup]   ${b} = ${paths.length}`);
  }

  const finishedAt = new Date();
  const elapsedMs = finishedAt - startedAt;

  const payload = {
    schemaVersion: 1,
    purpose: "wipe-products-pre-snapshot",
    project: SB_URL,
    backedUpAt: finishedAt.toISOString(),
    elapsedMs,
    counts: {
      products: products.length,
      product_images: productImages.length,
      "api_usage(product-linked)": apiUsage.length,
    },
    preservedCounts,
    storagePaths,
    rows: {
      products,
      product_images: productImages,
      api_usage_product_linked: apiUsage,
    },
  };

  const outDir = join(homedir(), "decoright-backups");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `products-${stamp}.json`);
  writeFileSync(outPath, JSON.stringify(payload, null, 2));

  const sizeBytes = statSync(outPath).size;
  const sizeKb = (sizeBytes / 1024).toFixed(1);

  console.log("");
  console.log("──────────────────────────────────────────────────");
  console.log(`✅ backup written: ${outPath}`);
  console.log(`   size: ${sizeBytes} bytes (${sizeKb} KB)`);
  console.log(`   elapsed: ${elapsedMs} ms`);
  console.log("──────────────────────────────────────────────────");
  console.log("");
  console.log("Counts (will be deleted in Step 3):");
  console.log(`  products              = ${products.length}`);
  console.log(`  product_images        = ${productImages.length}`);
  console.log(`  api_usage(linked)     = ${apiUsage.length}  [SET NULL, not deleted]`);
  console.log("");
  console.log("Preserved table counts:");
  for (const [t, v] of Object.entries(preservedCounts)) {
    if (typeof v === "number") {
      console.log(`  ${t.padEnd(22)} = ${v}`);
    } else {
      console.log(`  ${t.padEnd(22)} = (skipped: ${v.error})`);
    }
  }
  console.log("");
  console.log("Storage buckets:");
  for (const [b, info] of Object.entries(storagePaths)) {
    const willWipe = b === "raw-images" || b === "cutouts";
    console.log(
      `  ${b.padEnd(12)} = ${String(info.count).padStart(4)} objects  ${willWipe ? "[WILL WIPE]" : "[preserve]"}`,
    );
  }
  console.log("");
  console.log("STOP. Show this report to Jym before proceeding to Step 3.");
})().catch((err) => {
  console.error("\n❌ backup failed:", err);
  process.exit(2);
});
