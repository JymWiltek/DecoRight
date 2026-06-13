"use server";

import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  SESSION_COOKIE,
  SESSION_TTL_DAYS,
  createSession,
} from "@/lib/auth/session";
import { designerSub } from "@/lib/auth/require-designer";
import { createServiceRoleClient } from "@/lib/supabase/service";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Only allow same-site /designer or /product paths through the login
// round-trip (so the FBX button can deep-link back to a product).
const SAFE_NEXT_RE = /^\/(designer|product|c|bundle)(\/[A-Za-z0-9/_\-[\].]*)?(\?[A-Za-z0-9=&_\-%]*)?$/;
function safeNext(raw: string | null | undefined): string {
  if (!raw || !SAFE_NEXT_RE.test(raw)) return "/designer";
  if (raw.startsWith("/designer/login") || raw.startsWith("/designer/register")) {
    return "/designer";
  }
  return raw;
}

function setSessionCookie(token: string, jar: Awaited<ReturnType<typeof cookies>>) {
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_DAYS * 86400,
  });
}

export async function designerLogin(fd: FormData): Promise<void> {
  const email = fd.get("email")?.toString().trim().toLowerCase() ?? "";
  const password = fd.get("password")?.toString() ?? "";
  const next = safeNext(fd.get("next")?.toString());
  const back = (err: string) =>
    `/designer/login?error=${err}&next=${encodeURIComponent(next)}`;

  if (!email || !password) redirect(back("missing"));

  const supabase = createServiceRoleClient();
  const { data: designer } = await supabase
    .from("designers")
    .select("id, password_hash, status")
    .eq("email", email)
    .maybeSingle();

  // Generic "bad" for unknown email / no password / wrong password so we
  // don't leak which emails exist.
  if (!designer || !designer.password_hash) redirect(back("bad"));
  if (designer.status !== "active") redirect(back("suspended"));
  const okPw = await bcrypt.compare(password, designer.password_hash);
  if (!okPw) redirect(back("bad"));

  await supabase
    .from("designers")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", designer.id);

  const token = await createSession(designerSub(designer.id));
  setSessionCookie(token, await cookies());
  redirect(next);
}

export async function designerRegister(fd: FormData): Promise<void> {
  const email = fd.get("email")?.toString().trim().toLowerCase() ?? "";
  const password = fd.get("password")?.toString() ?? "";
  const name = fd.get("name")?.toString().trim() ?? "";
  const next = safeNext(fd.get("next")?.toString());
  const back = (err: string) =>
    `/designer/register?error=${err}&next=${encodeURIComponent(next)}`;

  if (!EMAIL_RE.test(email)) redirect(back("email"));
  if (password.length < 6) redirect(back("weak"));
  if (!name) redirect(back("name"));

  const supabase = createServiceRoleClient();
  const { data: existing } = await supabase
    .from("designers")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (existing) redirect(back("taken"));

  const passwordHash = await bcrypt.hash(password, 10);
  const { data: created, error: insErr } = await supabase
    .from("designers")
    .insert({ email, name, password_hash: passwordHash, status: "active" })
    .select("id")
    .single();
  if (insErr || !created) redirect(back("db"));

  // Mirror admin createDesigner: a zero-balance credit row so credit
  // ops have something to move against.
  await supabase
    .from("credit_balances")
    .insert({ designer_id: created.id, credit_balance: 0 });

  const token = await createSession(designerSub(created.id));
  setSessionCookie(token, await cookies());
  redirect(next);
}

export async function designerLogout(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  redirect("/designer/login");
}
