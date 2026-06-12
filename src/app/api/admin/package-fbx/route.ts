/**
 * /api/admin/package-fbx — POST { product_id }.
 *
 * Wave 11b FBX-bundle packager. The dual-upload flow writes the .fbx
 * to `models/products/<id>/model.fbx` and its texture maps to
 * `models/products/<id>/textures/`. This route zips them into
 * `models/products/<id>/fbx-bundle.zip` (model.fbx + textures/) and
 * writes the public URL to products.fbx_bundle_url so the storefront
 * "Download FBX" button serves the bundle instead of the bare .fbx.
 *
 * Mirrors the compress-glb route: own maxDuration budget (zipping a
 * 100 MB .fbx in memory takes time), dual auth (admin cookie OR
 * x-cron-secret for the server-action dispatch path), always-JSON.
 *
 * Failure modes:
 *   200 { ok: true, size_kb, texture_count }
 *   400 invalid product_id / no JSON body
 *   401 no session AND no/wrong cron secret
 *   404 product not found
 *   422 product has no .fbx to bundle (NoFbxError)
 *   500 zip / upload / db threw
 *
 * No fbx_bundle status column: bundling is best-effort. If it fails
 * the storefront keeps serving the bare fbx_url (data-protection:
 * a failed re-package never breaks an existing download).
 */

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { packageFbxBundle, NoFbxError } from "@/lib/fbx-bundle";

export const runtime = "nodejs"; // jszip + Buffer work; keep off edge
export const maxDuration = 120; // zipping a ~100 MB .fbx in memory

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  // ── 1. authenticate (same two paths compress-glb uses) ─────
  const cronHeader = req.headers.get("x-cron-secret");
  if (cronHeader) {
    if (!(await verifyCronSecret(cronHeader))) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  } else {
    try {
      await requireAdmin();
    } catch {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  // ── 2. parse + validate body ───────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  const productId =
    body && typeof body === "object" && "product_id" in body
      ? String((body as Record<string, unknown>).product_id ?? "")
      : "";
  if (!UUID_RE.test(productId)) {
    return NextResponse.json({ ok: false, error: "invalid product_id" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  // ── 3. confirm product exists ──────────────────────────────
  const { data: product, error: fetchErr } = await supabase
    .from("products")
    .select("id, fbx_url")
    .eq("id", productId)
    .maybeSingle();
  if (fetchErr) {
    return NextResponse.json(
      { ok: false, error: "db error", detail: fetchErr.message },
      { status: 500 },
    );
  }
  if (!product) {
    return NextResponse.json({ ok: false, error: "product not found" }, { status: 404 });
  }

  // ── 4. build + upload the zip ──────────────────────────────
  let result;
  try {
    result = await packageFbxBundle(productId);
  } catch (err) {
    if (err instanceof NoFbxError) {
      return NextResponse.json(
        { ok: false, error: "no_fbx", detail: "upload an .fbx first" },
        { status: 422 },
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: "package failed", detail: msg },
      { status: 500 },
    );
  }

  // ── 5. write bundle URL + size to DB ───────────────────────
  const { error: updErr } = await supabase
    .from("products")
    .update({
      fbx_bundle_url: result.url,
      fbx_bundle_size_kb: result.sizeKb,
    })
    .eq("id", productId);
  if (updErr) {
    return NextResponse.json(
      { ok: false, error: "db update failed", detail: updErr.message },
      { status: 500 },
    );
  }

  // ── 6. bust caches that read fbx_bundle_url ────────────────
  revalidatePath("/admin");
  revalidatePath(`/admin/products/${productId}/edit`);
  revalidatePath(`/product/${productId}`);

  return NextResponse.json({
    ok: true,
    product_id: productId,
    size_kb: result.sizeKb,
    texture_count: result.textureCount,
  });
}

export async function GET() {
  return new NextResponse("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
}

/** Same verifier compress-glb / unify-thumbnail use (mig 0036 RPC). */
async function verifyCronSecret(provided: string): Promise<boolean> {
  if (!provided) return false;
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("get_cron_secret" as never);
  if (error) return false;
  const expected =
    typeof (data as unknown) === "string" ? (data as unknown as string) : "";
  if (!expected) return false;
  if (expected.length !== provided.length) return false;
  let r = 0;
  for (let i = 0; i < expected.length; i++) {
    r |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return r === 0;
}
