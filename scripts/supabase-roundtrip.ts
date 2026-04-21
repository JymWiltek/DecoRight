/**
 * Supabase round-trip sanity test.
 * Inserts a throwaway product, reads it back, updates it, deletes it.
 * Run: `npm run supabase:test`
 *
 * Uses the service-role client (bypasses RLS) so we can write without auth.
 *
 * Post Phase-2.5: taxonomy is DB-managed. Slug validity is enforced in the
 * admin UI against live taxonomy tables — NOT by Postgres CHECK — so the
 * old "verify CHECK rejects bad enum" step was dropped.
 */
import { createServiceRoleClient } from "../src/lib/supabase/service";

const TEST_PRODUCT_MARKER = "__roundtrip_test__";

async function main() {
  const supabase = createServiceRoleClient();

  console.log("→ INSERT test product");
  const { data: inserted, error: insertErr } = await supabase
    .from("products")
    .insert({
      name: TEST_PRODUCT_MARKER,
      brand: "DecoRight QA",
      item_type: "faucet",
      styles: ["modern"],
      colors: ["chrome"],
      materials: ["chrome_plated"],
      price_myr: 499,
      price_tier: "mid",
      description: "A throwaway product created by scripts/supabase-roundtrip.ts",
    })
    .select()
    .single();

  if (insertErr || !inserted) throw insertErr ?? new Error("insert returned no row");
  console.log(
    `  ✓ id=${inserted.id}, status=${inserted.status}, created_at=${inserted.created_at}`,
  );

  console.log("→ SELECT back by id");
  const { data: read, error: readErr } = await supabase
    .from("products")
    .select("*")
    .eq("id", inserted.id)
    .single();
  if (readErr || !read) throw readErr ?? new Error("select returned no row");
  if (read.name !== TEST_PRODUCT_MARKER) throw new Error(`name mismatch: ${read.name}`);
  console.log(`  ✓ name="${read.name}", item_type=${read.item_type}`);

  console.log("→ UPDATE (verify updated_at trigger fires)");
  const before = read.updated_at;
  await new Promise((r) => setTimeout(r, 1100));
  const { data: updated, error: updErr } = await supabase
    .from("products")
    .update({ description: "modified by round-trip" })
    .eq("id", inserted.id)
    .select()
    .single();
  if (updErr || !updated) throw updErr ?? new Error("update returned no row");
  if (updated.updated_at === before) {
    throw new Error(`updated_at did not advance (${before} === ${updated.updated_at})`);
  }
  console.log(`  ✓ updated_at advanced: ${before} → ${updated.updated_at}`);

  console.log("→ DELETE");
  const { error: delErr } = await supabase
    .from("products")
    .delete()
    .eq("id", inserted.id);
  if (delErr) throw delErr;
  console.log("  ✓ deleted");

  console.log("→ Verify gone");
  const { data: gone } = await supabase
    .from("products")
    .select("id")
    .eq("id", inserted.id)
    .maybeSingle();
  if (gone) throw new Error("row still exists after delete");
  console.log("  ✓ row gone");

  console.log("\n✅ All round-trip checks passed");
}

main().catch((err) => {
  console.error("\n❌ Round-trip failed:", err);
  process.exit(1);
});
