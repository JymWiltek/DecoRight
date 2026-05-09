/**
 * Wave 2 backfill — re-unify thumbnails for every published product
 * that has a primary cutout but no `unified.png` (or whose existing
 * thumbnail predates this script).
 *
 * Mode: sequential POSTs to LOCAL or PROD via the same
 * /api/admin/unify-thumbnail route the trigger uses. Sequential is
 * deliberate — the route holds 5–15 s of sharp CPU per product;
 * parallel calls would stall the serverless function pool and don't
 * speed this up meaningfully (the bottleneck is per-call CPU, not
 * latency).
 *
 * Auth: uses the cron secret from private._app_config so we don't
 * need a browser session. Same path the trigger takes — easier than
 * minting a session token and gives identical-to-prod semantics.
 *
 * Usage:
 *   # local (against `npm run start` on :3000):
 *   npx tsx --env-file=.env.local scripts/backfill-unified-thumbnails.ts
 *
 *   # prod:
 *   APP_BASE_URL=https://deco-right.vercel.app \
 *     npx tsx --env-file=.env.local scripts/backfill-unified-thumbnails.ts
 *
 * Output: one line per product, with timing + bytes.
 */
import { createClient } from "@supabase/supabase-js";

const APP_BASE_URL = process.env.APP_BASE_URL || "http://localhost:3000";
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_APP_SUPABASE_URL ||
  "https://mooggzqjybwuprrsgnny.supabase.co";
const SERVICE_KEY: string | undefined = process.env.APP_SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  console.error("APP_SUPABASE_SERVICE_ROLE_KEY missing");
  process.exit(1);
}

async function main() {
  // Non-null assertion: process.exit above guarantees we don't reach
  // here without SERVICE_KEY, but tsc's narrowing doesn't follow that.
  const sb = createClient(SUPABASE_URL, SERVICE_KEY!);

  // Find every published product with a primary cutout to re-unify.
  // The query runs RLS-bypass (service role) so the join sees all
  // approved cutout rows.
  const { data: rows, error } = await sb
    .from("products")
    .select("id, name, thumbnail_url")
    .eq("status", "published")
    .order("name");
  if (error) throw error;

  // Cron secret for the route's bypass-admin path. Read via the
  // get_cron_secret() RPC (mig 0036) since the private schema isn't
  // PostgREST-exposed.
  const { data: secretData } = await sb.rpc("get_cron_secret" as never);
  const secret = typeof secretData === "string" ? secretData : "";
  if (!secret) {
    console.error("cron_secret missing in private._app_config");
    process.exit(1);
  }

  console.log(`Backfilling ${rows?.length ?? 0} published products via ${APP_BASE_URL}\n`);

  let ok = 0;
  let skip = 0;
  let fail = 0;

  for (const p of rows ?? []) {
    const t0 = Date.now();
    try {
      const r = await fetch(`${APP_BASE_URL}/api/admin/unify-thumbnail`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Cron-Secret": secret,
        },
        body: JSON.stringify({ product_id: p.id }),
      });
      const elapsed = Date.now() - t0;
      const json: unknown = await r.json().catch(() => ({}));
      const j = json as { ok?: boolean; error?: string; unified_bytes?: number };
      if (r.status === 200 && j.ok) {
        ok++;
        console.log(
          `  OK     ${p.id.slice(0, 8)}  ${(j.unified_bytes! / 1024).toFixed(0).padStart(4)} KB  ${elapsed}ms  ${p.name}`,
        );
      } else if (r.status === 404) {
        skip++;
        console.log(`  SKIP   ${p.id.slice(0, 8)}  no primary cutout      ${p.name}`);
      } else {
        fail++;
        console.log(
          `  FAIL   ${p.id.slice(0, 8)}  http=${r.status} err=${j.error}  ${p.name}`,
        );
      }
    } catch (e) {
      fail++;
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  FAIL   ${p.id.slice(0, 8)}  thrown: ${msg}  ${p.name}`);
    }
  }

  console.log(`\nDone. ${ok} ok, ${skip} skipped (no cutout), ${fail} failed.`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
