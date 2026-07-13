import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Feature 6 — Google OAuth redirect target. Supabase bounces the visitor
 * back here with a `?code=` after Google consent; we exchange it for a
 * session (writes the sb-* auth cookies — allowed here because a Route
 * Handler can set cookies) and redirect to `next` (the product page they
 * came from, so the AR gate is already unlocked on arrival).
 *
 * Requires the Google provider to be enabled in the Supabase dashboard
 * (Authentication → Providers → Google) with this route's URL added to the
 * allowed redirect URLs. Until then the email/password path is the live
 * one; the Google button surfaces a friendly "not available yet" notice.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = sanitizeNext(url.searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const sep = next.includes("?") ? "&" : "?";
      return NextResponse.redirect(
        new URL(`${next}${sep}auth_error=1`, url.origin),
      );
    }
  }
  return NextResponse.redirect(new URL(next, url.origin));
}

/** Only allow same-origin absolute paths as the post-login destination. */
function sanitizeNext(n: string | null): string {
  if (!n || !n.startsWith("/") || n.startsWith("//")) return "/";
  return n;
}
