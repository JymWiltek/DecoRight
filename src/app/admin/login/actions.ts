"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_TTL_DAYS, createSession } from "@/lib/auth/session";

// Strict: only ASCII admin paths. Blocks Chinese-IME garbage like
// "/admin/login，用" from leaking into a post-login redirect that 404s.
const SAFE_NEXT_RE = /^\/admin(\/[A-Za-z0-9/_\-[\].]*)?(\?[A-Za-z0-9=&_\-%]*)?$/;

function sanitizeNext(raw: string | null | undefined): string {
  if (!raw) return "/admin";
  if (!SAFE_NEXT_RE.test(raw)) return "/admin";
  // Never bounce the user right back to login.
  if (raw === "/admin/login" || raw.startsWith("/admin/login?")) return "/admin";
  return raw;
}

export async function login(formData: FormData): Promise<void> {
  const pw = formData.get("password")?.toString() ?? "";
  const next = sanitizeNext(formData.get("next")?.toString());

  const expected = process.env.APP_ADMIN_PASSWORD;
  if (!expected) {
    redirect(`/admin/login?error=server&next=${encodeURIComponent(next)}`);
  }
  if (pw !== expected) {
    redirect(`/admin/login?error=bad&next=${encodeURIComponent(next)}`);
  }

  const token = await createSession();
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_DAYS * 86400,
  });

  redirect(next);
}
