/**
 * /api/admin/scene-cover — POST { product_id }.
 *
 * Wave 13 scene-cover worker. When a white-bg cutout becomes a product's
 * primary thumbnail, attachStagedRawImages fires dispatchSceneCover() from
 * inside after(), which POSTs here. This route runs the fidelity-safe
 * "empty scene + composite original" generator (rembg → gpt-image-1 empty
 * room → composite exact product pixels) and sets the product's list cover.
 *
 * Why a dedicated route (not inline after()): the generator makes an
 * external image call (~30-60 s). A server action's after() inherits the
 * action's short maxDuration; this route gets its own 120 s budget — same
 * playbook as /api/admin/compress-glb.
 *
 * Stateless: idempotency + "skip already-scened / non-white-bg" all live in
 * maybeGenerateSceneCover. A failure throws here → 500 + server log; the
 * product keeps its white-bg cover and the next upload re-fires. No status
 * column, so nothing to leave "stuck".
 *
 * Auth — accepts EITHER an admin session cookie (manual trigger) OR a
 * matching x-cron-secret header (the after() dispatch path).
 */
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { maybeGenerateSceneCover } from "@/lib/scene-cover";

export const runtime = "nodejs"; // sharp + rembg provider + external fetch
export const maxDuration = 120; // gpt-image-1 generation tail

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  // ── 1. authenticate (same two paths compress-glb uses) ──
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

  // ── 2. parse + validate body ──
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

  // ── 3. run the generator. ANY throw → 500 + log, cover untouched ──
  try {
    const result = await maybeGenerateSceneCover(productId);
    if (result.status === "done") {
      revalidatePath("/");
      revalidatePath("/admin");
      revalidatePath(`/product/${productId}`);
    }
    return NextResponse.json({ ok: true, product_id: productId, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[scene-cover] ${productId} failed:`, msg);
    return NextResponse.json(
      { ok: false, error: "scene cover failed", detail: msg },
      { status: 500 },
    );
  }
}

export async function GET() {
  return new NextResponse("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
}

async function verifyCronSecret(provided: string): Promise<boolean> {
  if (!provided) return false;
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("get_cron_secret" as never);
  if (error) return false;
  const expected =
    typeof (data as unknown) === "string" ? (data as unknown as string) : "";
  if (!expected || expected.length !== provided.length) return false;
  let r = 0;
  for (let i = 0; i < expected.length; i++) {
    r |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return r === 0;
}
