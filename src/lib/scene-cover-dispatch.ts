import "server-only";

import { headers } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * Fire-and-forget POST to /api/admin/scene-cover to auto-generate a
 * "scene cover" for one product. Fired from inside `after()` in
 * attachStagedRawImages the moment a white-bg cutout becomes the primary
 * thumbnail, so the operator's Save/upload returns immediately while the
 * cover generates on the route handler's own `maxDuration = 120` budget.
 *
 * Same shape + security rationale as dispatchGlbCompression: this lives in
 * a non-"use server" module so it is NOT exposed as a public server action,
 * and it authenticates the route via the shared cron secret (mig 0036
 * `get_cron_secret`). Never throws — the caller has already returned to the
 * client; a failed dispatch just means the product keeps its white-bg cover
 * and the next upload re-fires.
 */
export async function dispatchSceneCover(productId: string): Promise<void> {
  try {
    const supabase = createServiceRoleClient();
    const { data: secretData, error: secretErr } = await supabase.rpc(
      "get_cron_secret" as never,
    );
    if (secretErr) return;
    const secret =
      typeof (secretData as unknown) === "string"
        ? (secretData as unknown as string)
        : "";
    if (!secret) return;

    const h = await headers();
    const host =
      h.get("host") ||
      process.env.VERCEL_URL ||
      process.env.NEXT_PUBLIC_SITE_URL?.replace(/^https?:\/\//, "");
    if (!host) return;
    const proto = h.get("x-forwarded-proto") || "https";
    const url = `${proto}://${host}/api/admin/scene-cover`;

    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-cron-secret": secret },
      body: JSON.stringify({ product_id: productId }),
    }).catch(() => {});
  } catch {
    // Never throw inside after(); the next upload re-fires.
  }
}
