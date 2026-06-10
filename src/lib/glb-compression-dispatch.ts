import "server-only";

import { headers } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * Fire-and-forget POST to /api/admin/compress-glb to kick the Draco
 * worker for one product. Used from inside `after()` callbacks in
 * updateProduct and retryGlbCompression so the operator's Save /
 * Retry returns immediately while the worker runs on the route
 * handler's own `maxDuration = 120` budget.
 *
 * Why this lives in a non-"use server" file: it must NOT be
 * exposed as a Next server action. Anything exported from a
 * "use server" file is a public RPC callable by any client. The
 * dispatcher mints a cron secret via service-role and would let a
 * malicious caller trigger compression on arbitrary product IDs.
 * Keeping it here makes it a plain module-level function — only
 * server code can import it.
 *
 * Auth: mints the cron secret via the same RPC the route handler
 * verifies against (mig 0036 `get_cron_secret`). If the secret
 * lookup fails, we silently skip — the row stays at 'pending' and
 * the operator can hit Retry. We never throw here; the caller has
 * already returned to the client.
 */
export async function dispatchGlbCompression(productId: string): Promise<void> {
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

    // Build absolute URL from the calling request's host header.
    // `headers()` inside `after()` in a server action returns the
    // originating request's headers — that's the public-facing host
    // (preview deploy URL, prod URL, localhost) which is exactly what
    // we want to fetch on. Fall back to VERCEL_URL for environments
    // where headers() isn't available (e.g. a cron task that
    // dispatched this directly — not used today but defends against
    // future drift).
    const h = await headers();
    const host =
      h.get("host") ||
      process.env.VERCEL_URL ||
      process.env.NEXT_PUBLIC_SITE_URL?.replace(/^https?:\/\//, "");
    if (!host) return;
    const proto = h.get("x-forwarded-proto") || "https";
    const url = `${proto}://${host}/api/admin/compress-glb`;

    // Fire and forget. The route handler runs to its own 120 s
    // budget; if the network call itself errors (route not deployed
    // yet on a preview, etc.) the row stays at 'pending' and the
    // Retry button can re-fire.
    await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-cron-secret": secret,
      },
      body: JSON.stringify({ product_id: productId }),
    }).catch(() => {});
  } catch {
    // Never let the dispatcher throw inside after() — would surface
    // in logs as an unhandled rejection without anyone able to
    // react. The pending row + Retry button is the recovery surface.
  }
}
