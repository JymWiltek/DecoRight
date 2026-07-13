"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

export type ConsumerAuthState = {
  ok: boolean;
  /** i18n key suffix; the modal renders `authGate.err_<error>`. */
  error?:
    | "invalid_email"
    | "short_password"
    | "wrong_password"
    | "server";
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Feature 6 — sign in OR register a storefront consumer with email +
 * password, then establish a Supabase Auth session cookie so the AR gate
 * on the product page unlocks.
 *
 * Why admin.createUser (service role) rather than the public `signUp()`:
 * this project has email-confirmation ON and the built-in SMTP is
 * rate-limited to a few sends/hour (verified empirically). `signUp()`
 * would therefore (a) not return a usable session until the visitor clicks
 * a confirmation email, and (b) rate-limit out under any real volume. The
 * gate exists to CAPTURE the email for marketing, not to verify
 * deliverability — so we create the account already-confirmed (no email is
 * sent) and sign them straight in. To later require real email
 * verification, configure custom SMTP in the Supabase dashboard and switch
 * this to `signUp()`; this action is the only place that changes.
 */
export async function consumerEmailAuth(
  _prev: ConsumerAuthState,
  formData: FormData,
): Promise<ConsumerAuthState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!EMAIL_RE.test(email)) return { ok: false, error: "invalid_email" };
  if (password.length < 6) return { ok: false, error: "short_password" };

  // Anon client with the cookie writer — inside a Server Action, setAll is
  // NOT swallowed, so signInWithPassword persists the sb-* session cookies.
  const supabase = await createClient();

  // 1. Existing account → straight sign-in.
  const first = await supabase.auth.signInWithPassword({ email, password });
  if (!first.error) return { ok: true };

  // 2. No account yet → create it confirmed (no email) then sign in.
  //    signInWithPassword returns "Invalid login credentials" for BOTH
  //    "no such user" AND "wrong password"; we disambiguate by trying to
  //    create — createUser fails if the email already exists, which means
  //    the password was simply wrong.
  const admin = createServiceRoleClient();
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { source: "ar_gate" },
  });
  if (created.error) {
    const msg = created.error.message.toLowerCase();
    if (
      msg.includes("already") ||
      msg.includes("registered") ||
      msg.includes("exists")
    ) {
      return { ok: false, error: "wrong_password" };
    }
    return { ok: false, error: "server" };
  }

  const second = await supabase.auth.signInWithPassword({ email, password });
  if (second.error) return { ok: false, error: "server" };
  return { ok: true };
}

/** Feature 6 — clear the consumer's Supabase session (re-locks AR). */
export async function consumerSignOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
}
