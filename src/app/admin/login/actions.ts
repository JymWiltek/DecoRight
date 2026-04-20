"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_TTL_DAYS, createSession } from "@/lib/auth/session";

const SAFE_NEXT_RE = /^\/admin(\/|$)/;

export async function login(formData: FormData): Promise<void> {
  const pw = formData.get("password")?.toString() ?? "";
  const nextRaw = formData.get("next")?.toString() ?? "/admin";
  const next = SAFE_NEXT_RE.test(nextRaw) ? nextRaw : "/admin";

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
