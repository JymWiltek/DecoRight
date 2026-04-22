/**
 * Probe whether migration 0003 has been applied. Uses only
 * features added/changed by 0003 (item_subtypes, app_config,
 * api_usage, item_types.room_slug, products.subtype_slug, the
 * mirror split, the gamer_pc deletion). Reports a checklist.
 *
 * Run: npx tsx --env-file=.env.local scripts/check-0003.ts
 */
import { createServiceRoleClient } from "../src/lib/supabase/service";

async function probe(label: string, fn: () => Promise<{ ok: boolean; detail: string }>) {
  try {
    const { ok, detail } = await fn();
    console.log(`${ok ? "✓" : "✗"} ${label}  — ${detail}`);
    return ok;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`✗ ${label}  — ERROR: ${msg}`);
    return false;
  }
}

async function main() {
  const supabase = createServiceRoleClient();
  let allOk = true;

  console.log("\n=== Migration 0003 verification ===\n");

  allOk = (await probe("item_subtypes table exists", async () => {
    const { error } = await supabase.from("item_subtypes").select("slug").limit(1);
    return error
      ? { ok: false, detail: error.message }
      : { ok: true, detail: "selectable" };
  })) && allOk;

  allOk = (await probe("app_config table exists with 7 keys", async () => {
    const { data, error } = await supabase.from("app_config").select("key");
    if (error) return { ok: false, detail: error.message };
    return {
      ok: (data?.length ?? 0) >= 7,
      detail: `${data?.length ?? 0} keys: ${(data ?? []).map((r) => r.key).join(", ")}`,
    };
  })) && allOk;

  allOk = (await probe("api_usage table exists (count = 0 expected)", async () => {
    const { count, error } = await supabase
      .from("api_usage")
      .select("id", { count: "exact", head: true });
    if (error) return { ok: false, detail: error.message };
    return { ok: true, detail: `${count} rows` };
  })) && allOk;

  allOk = (await probe(
    "product_images has state + rembg_provider + rembg_cost_usd (post-0004)",
    async () => {
      // Probe each column separately — `select *` returns successfully even
      // when columns are missing if the table is empty, so we have to ask
      // for each column by name to actually catch column-shape drift.
      for (const col of ["state", "rembg_provider", "rembg_cost_usd"]) {
        const { error } = await supabase
          .from("product_images")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .select(col as any)
          .limit(1);
        if (error) {
          return {
            ok: false,
            detail: `column "${col}" missing: ${error.message}`,
          };
        }
      }
      return { ok: true, detail: "all 3 new columns present" };
    },
  )) && allOk;

  allOk = (await probe(
    "api_usage has product_image_id + note (post-0004)",
    async () => {
      for (const col of ["product_image_id", "note"]) {
        const { error } = await supabase
          .from("api_usage")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .select(col as any)
          .limit(1);
        if (error) {
          return {
            ok: false,
            detail: `column "${col}" missing: ${error.message}`,
          };
        }
      }
      return { ok: true, detail: "both columns present" };
    },
  )) && allOk;

  allOk = (await probe("item_types.room_slug column exists", async () => {
    const { data, error } = await supabase
      .from("item_types")
      .select("slug,room_slug")
      .limit(1);
    if (error) return { ok: false, detail: error.message };
    if (data && data.length > 0 && !("room_slug" in data[0])) {
      return { ok: false, detail: "row missing room_slug key" };
    }
    return { ok: true, detail: "present" };
  })) && allOk;

  allOk = (await probe("mirror split: bathroom_mirror + full_body_mirror present, mirror gone", async () => {
    const { data, error } = await supabase
      .from("item_types")
      .select("slug")
      .in("slug", ["mirror", "bathroom_mirror", "full_body_mirror"]);
    if (error) return { ok: false, detail: error.message };
    const slugs = new Set((data ?? []).map((r) => r.slug));
    const ok =
      !slugs.has("mirror") &&
      slugs.has("bathroom_mirror") &&
      slugs.has("full_body_mirror");
    return { ok, detail: `present: [${Array.from(slugs).join(", ") || "—"}]` };
  })) && allOk;

  allOk = (await probe("gamer_pc deleted", async () => {
    const { data, error } = await supabase
      .from("item_types")
      .select("slug")
      .eq("slug", "gamer_pc");
    if (error) return { ok: false, detail: error.message };
    return {
      ok: (data?.length ?? 0) === 0,
      detail: (data?.length ?? 0) === 0 ? "gone" : "still present",
    };
  })) && allOk;

  allOk = (await probe("products.rooms column dropped", async () => {
    // Try to select it; should error if dropped. Cast through `any`
    // because supabase-js's typed select doesn't even know rooms used
    // to be a column, so we can't @ts-expect-error here.
    const { error } = await supabase
      .from("products")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .select("rooms" as any)
      .limit(1);
    return {
      ok: Boolean(error),
      detail: error
        ? `errored as expected: ${error.message}`
        : "still queryable — column not dropped",
    };
  })) && allOk;

  allOk = (await probe("reserve_api_slot RPC exists", async () => {
    const { error } = await supabase.rpc("reserve_api_slot", {
      p_service: "replicate_rembg",
      p_product_id: null,
      p_product_image_id: null,
      p_note: "probe — refunded immediately",
    });
    if (error) {
      // Failure modes we accept as "function exists and works":
      //   - quota / daily_limit raised
      //   - emergency_stop on
      //   - any other domain error from inside the function body
      // Failure modes we reject as broken installs:
      //   - "does not exist" / "could not find the function": wrong sig
      //   - "ambiguous": output param of RETURNS TABLE shadowing a column
      //   - "syntax error": function body itself won't parse
      //   - "invalid input syntax for type uuid": api_usage.id is the
      //     wrong type, function can't return it (post-0006 fix)
      const msg = error.message.toLowerCase();
      const broken =
        msg.includes("does not exist") ||
        msg.includes("could not find the function") ||
        msg.includes("ambiguous") ||
        msg.includes("syntax error") ||
        msg.includes("invalid input syntax for type uuid");
      return {
        ok: !broken,
        detail: broken
          ? `BROKEN: ${error.message}`
          : `function exists (returned: ${error.message})`,
      };
    }
    // A real reservation happened — refund it so we don't pollute.
    // Cheap self-clean: insert a refund row matching the reservation.
    return { ok: true, detail: "function exists and reserved a slot" };
  })) && allOk;

  // Best-effort cleanup of any reservation we just made above.
  await supabase
    .from("api_usage")
    .delete()
    .eq("note", "probe — refunded immediately");

  console.log("");
  if (allOk) {
    console.log("✅ Migration 0003 fully applied.\n");
    process.exit(0);
  } else {
    console.log(
      "❌ Migration 0003 NOT fully applied. Run the SQL in Supabase SQL Editor.\n",
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
