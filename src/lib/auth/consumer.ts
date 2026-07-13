import "server-only";

import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Feature 6 — consumer (storefront visitor) identity, backed by Supabase
 * Auth (auth.users). This is DISTINCT from the admin/designer custom
 * `dr_session` JWT (src/lib/auth/session.ts): storefront visitors sign in
 * with Google or email so we can gate the AR try-on and grow a marketing
 * list. The two cookie schemes coexist — a consumer login never touches
 * /admin or /designer, and vice versa.
 *
 * `getUser()` validates the JWT against Supabase's auth server (not just
 * the cookie), so its answer is safe to trust for the gate. It's called
 * from Server Components, where cookie WRITES are swallowed
 * (see supabase/server.ts) — that only blocks token *refresh*, not reads,
 * so a fresh session (the common case, right after login) resolves fine.
 * Long-lived refresh would need the @supabase/ssr middleware pattern;
 * that's the documented production-hardening follow-up, not needed for the
 * gate itself.
 */
export async function getConsumerUser(): Promise<User | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user ?? null;
}

/** The visitor's login method, for the "signed in as …" hint. */
export function consumerProvider(user: User): string {
  return (
    (user.app_metadata?.provider as string | undefined) ??
    user.identities?.[0]?.provider ??
    "email"
  );
}
