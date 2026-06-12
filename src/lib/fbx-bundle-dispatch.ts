import "server-only";

import { headers } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * Fire-and-forget POST to /api/admin/package-fbx to (re)build a
 * product's FBX zip bundle. Called from inside `after()` in
 * updateProduct / bulkCreateProducts after the .fbx + textures land,
 * so the operator's Save returns immediately while the zip builds on
 * the route handler's own maxDuration=120 budget.
 *
 * Lives in a non-"use server" file (same reasoning as
 * glb-compression-dispatch): it mints the cron secret via service
 * role and must NOT be exposed as a public RPC. Module-level fn →
 * only server code can import it.
 *
 * Never throws — the bundle is best-effort. If it fails the
 * storefront keeps serving the bare fbx_url. The admin "Repackage"
 * button is the manual recovery surface.
 */
export async function dispatchFbxBundle(productId: string): Promise<void> {
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
    const url = `${proto}://${host}/api/admin/package-fbx`;

    await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-cron-secret": secret,
      },
      body: JSON.stringify({ product_id: productId }),
    }).catch(() => {});
  } catch {
    // best-effort; bare .fbx remains the fallback download.
  }
}
