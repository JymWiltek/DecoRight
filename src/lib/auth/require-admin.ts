import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "./session";

/**
 * Admin gate for server actions. The proxy middleware already blocks
 * unauthenticated requests from /admin/:path*, so any server action
 * CALLED FROM an /admin page goes through this for free — but React
 * server actions are addressable by URL and can in principle be
 * invoked from anywhere. Call this first inside every action that
 * mutates something or mints a capability (e.g. a signed upload URL).
 *
 * Throws on failure — server actions that catch it can translate to
 * a friendly error shape for the client.
 */
export async function requireAdmin(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) throw new Error("unauthorized");
}
