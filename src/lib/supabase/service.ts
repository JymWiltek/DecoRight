import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * Service-role client — bypasses RLS. Use only on the server (admin routes,
 * pipeline scripts). Never import from client components.
 *
 * Kept in its own module so Node.js scripts can import it without pulling in
 * `next/headers` (which throws outside Next's request runtime).
 */
export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_APP_SUPABASE_URL;
  const serviceKey = process.env.APP_SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_APP_SUPABASE_URL or APP_SUPABASE_SERVICE_ROLE_KEY — check .env.local",
    );
  }

  return createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
