/**
 * /api/admin/refill-draft — POST { product_id }.
 *
 * Re-runs the bulk-upload AI auto-fill (processDraftAsync / GPT-4o vision)
 * for one existing draft. Used to recover drafts whose original auto-fill
 * failed (e.g. OpenAI was out of quota) — reuses the EXACT same code path a
 * fresh bulk upload takes, so the fields fill identically. processDraftAsync
 * re-reads the product's feed_to_ai images from the DB, so passing images:[]
 * is enough (same call the bulk create makes).
 *
 * Auth — admin session cookie OR x-cron-secret (batch tool). Mirrors
 * compress-glb. Runs to its own 120 s budget so the GPT-4o call isn't cut off.
 */
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { processDraftAsync } from "@/app/admin/(dashboard)/products/actions";

export const runtime = "nodejs";
export const maxDuration = 120;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
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

  try {
    await processDraftAsync({ productId, images: [] });
    revalidatePath("/admin");
    revalidatePath(`/admin/products/${productId}/edit`);
    return NextResponse.json({ ok: true, product_id: productId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[refill-draft] ${productId} failed:`, msg);
    return NextResponse.json(
      { ok: false, error: "refill failed", detail: msg },
      { status: 500 },
    );
  }
}

export async function GET() {
  return new NextResponse("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
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
