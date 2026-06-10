/**
 * /api/admin/compress-glb — POST { product_id }.
 *
 * Wave 9 server-side Draco compression worker. The dual-upload
 * flow on /admin/products/[id]/edit writes the high-quality .glb
 * (40 MB typical) to `models/products/<id>/model.glb` and sets
 * `products.compression_status='pending'`. This route:
 *
 *   1. flips status to 'processing'
 *   2. runs compressGlbForProduct (validate → @gltf-transform Draco
 *      + webp texture pass → upload compressed bytes)
 *   3. on success → writes glb_compressed_url + size_kb + status='done'
 *      on any throw  → writes status='failed' + compression_error
 *
 * Why a route handler instead of inline `after()` inside
 * updateProduct: the segment maxDuration cap. A server action's
 * `after` callback inherits the calling route's maxDuration, default
 * 60 s on Vercel Pro. A 100 MB .glb's compression can take 60-90 s
 * on the tail, which would be killed mid-`io.writeBinary`. A
 * dedicated route handler gets its own 120 s budget, independent
 * of whatever action triggered it. Same playbook the unify-thumbnail
 * route uses (mirror its shape — auth + JSON I/O + cache-bust).
 *
 * Auth — accepts EITHER:
 *   • a logged-in admin session cookie (operator clicked a Retry
 *     button in admin); or
 *   • a matching `x-cron-secret` header for the server-action
 *     dispatch path (updateProduct fires this from inside `after`).
 *
 * Failure modes — always returns JSON:
 *   200 { ok: true, original_kb, compressed_kb, ratio }
 *   400 invalid product_id / no JSON body
 *   401 no session AND no/wrong cron secret
 *   404 product not found
 *   500 compression / upload / db threw — the row is at status='failed'
 */

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { compressGlbForProduct } from "@/lib/glb-compression";

export const runtime = "nodejs"; // @gltf-transform + draco3dgltf use Node addons / WASM
export const maxDuration = 120;  // Draco + texture-compress on ~60 MB worst-case

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  // ── 1. authenticate (same two paths unify-thumbnail uses) ──
  const cronHeader = req.headers.get("x-cron-secret");
  if (cronHeader) {
    const ok = await verifyCronSecret(cronHeader);
    if (!ok) {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 },
      );
    }
  } else {
    try {
      await requireAdmin();
    } catch {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 },
      );
    }
  }

  // ── 2. parse + validate body ───────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid json body" },
      { status: 400 },
    );
  }
  const productId =
    body && typeof body === "object" && "product_id" in body
      ? String((body as Record<string, unknown>).product_id ?? "")
      : "";
  if (!UUID_RE.test(productId)) {
    return NextResponse.json(
      { ok: false, error: "invalid product_id" },
      { status: 400 },
    );
  }

  const supabase = createServiceRoleClient();

  // ── 3. confirm the product exists + has a glb_url to compress ──
  // We don't require glb_url to be set — the dispatcher in
  // updateProduct flips compression_status='pending' BEFORE the
  // GLB URL is committed in the same UPDATE. But the dropzone
  // actually upserts to `products/<id>/model.glb` via signed URL
  // before the action runs, so the Storage object exists by the
  // time we get here. We rely on the worker's own download step
  // to surface "object missing" cleanly.
  const { data: product, error: fetchErr } = await supabase
    .from("products")
    .select("id, glb_url, compression_status")
    .eq("id", productId)
    .maybeSingle();
  if (fetchErr) {
    return NextResponse.json(
      { ok: false, error: "db error", detail: fetchErr.message },
      { status: 500 },
    );
  }
  if (!product) {
    return NextResponse.json(
      { ok: false, error: "product not found" },
      { status: 404 },
    );
  }

  // ── 4. flip status to 'processing' ─────────────────────────
  // Belt + braces: even if the dispatcher already set this, doing
  // it here means the Retry button (which goes through this same
  // route without going through updateProduct) gets the same
  // visual transition.
  await supabase
    .from("products")
    .update({ compression_status: "processing", compression_error: null })
    .eq("id", productId);

  // ── 5. run the worker. ANY throw lands at 'failed' ─────────
  let metrics;
  try {
    metrics = await compressGlbForProduct(productId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Park the row at failed with the categorized reason. NEVER
    // leave it at 'processing' — that's the "stuck forever" bug
    // we explicitly defended against.
    await supabase
      .from("products")
      .update({
        compression_status: "failed",
        compression_error: msg.slice(0, 1000),
      })
      .eq("id", productId);
    return NextResponse.json(
      { ok: false, error: "compression failed", detail: msg },
      { status: 500 },
    );
  }

  // ── 6. write success state to DB ───────────────────────────
  const { error: updErr } = await supabase
    .from("products")
    .update({
      compression_status: "done",
      compression_error: null,
      glb_compressed_url: metrics.compressedPublicUrl,
      glb_compressed_size_kb: metrics.compressedKb,
    })
    .eq("id", productId);
  if (updErr) {
    // We have the compressed bytes uploaded but couldn't write the
    // URL — operator will need to retry. Park at failed with a
    // clear reason so the Retry button shows.
    await supabase
      .from("products")
      .update({
        compression_status: "failed",
        compression_error: `db write failed after compression: ${updErr.message}`,
      })
      .eq("id", productId);
    return NextResponse.json(
      { ok: false, error: "db update failed", detail: updErr.message },
      { status: 500 },
    );
  }

  // ── 7. bust caches that read products.glb_compressed_url ──
  revalidatePath("/admin");
  revalidatePath(`/admin/products/${productId}/edit`);
  revalidatePath(`/product/${productId}`);

  return NextResponse.json({
    ok: true,
    product_id: productId,
    original_kb: metrics.originalKb,
    compressed_kb: metrics.compressedKb,
    ratio: metrics.ratio,
    warnings: metrics.warnings,
  });
}

// 405 on every other method so curl-based callers don't get the
// framework's HTML error page. Same pattern unify-thumbnail uses.
export async function GET() {
  return new NextResponse("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
}

/**
 * Compare the incoming `x-cron-secret` header against the value
 * stored in private._app_config.cron_secret via the SECURITY DEFINER
 * RPC `public.get_cron_secret()` (mig 0036). Mirrors the verifier
 * in /api/admin/unify-thumbnail — single rotation surface for both
 * Wave 2 (unify) and Wave 9 (compress) trigger callers.
 */
async function verifyCronSecret(provided: string): Promise<boolean> {
  if (!provided) return false;
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("get_cron_secret" as never);
  if (error) return false;
  const expected =
    typeof (data as unknown) === "string" ? (data as unknown as string) : "";
  if (!expected) return false;
  // Constant-time compare via length-equal early return + xor accumulator.
  if (expected.length !== provided.length) return false;
  let r = 0;
  for (let i = 0; i < expected.length; i++) {
    r |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return r === 0;
}
