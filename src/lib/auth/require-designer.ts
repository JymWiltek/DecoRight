import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "./session";

/** Session `sub` for a designer is `designer:<uuid>`. Admin sessions use
 *  `sub="admin"`. Keeping them in one cookie but distinguished by `sub`
 *  means a designer session can never satisfy requireAdmin (and vice
 *  versa). */
export const DESIGNER_SUB_PREFIX = "designer:";

export function designerSub(designerId: string): string {
  return DESIGNER_SUB_PREFIX + designerId;
}

/**
 * Designer gate for server actions / dashboard reads. Mirrors
 * requireAdmin but asserts the session is a DESIGNER session and returns
 * the designer id. Throws "unauthorized" otherwise.
 */
export async function requireDesigner(): Promise<{ designerId: string }> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session || !session.sub.startsWith(DESIGNER_SUB_PREFIX)) {
    throw new Error("unauthorized");
  }
  return { designerId: session.sub.slice(DESIGNER_SUB_PREFIX.length) };
}

/** Non-throwing variant for storefront pages that adapt UI to login
 *  state (e.g. the FBX download button). Returns null when not a
 *  logged-in designer. */
export async function getDesignerSession(): Promise<{ designerId: string } | null> {
  try {
    return await requireDesigner();
  } catch {
    return null;
  }
}
