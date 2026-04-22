"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { LOCALE_COOKIE, isLocale } from "@/i18n/config";

/**
 * Persist the user's locale choice to a cookie and force the current
 * page to re-render with the new messages. Called from the language
 * switcher dropdown in SiteHeader.
 *
 * Cookie is httpOnly=false so client components *could* read it, but
 * in practice every render already goes through src/i18n/request.ts
 * which reads it server-side. We set maxAge to 1 year — the user's
 * choice persists across sessions.
 */
export async function setLocale(nextLocale: string) {
  if (!isLocale(nextLocale)) {
    // Silently ignore — don't throw and break the UI on a bad value.
    return;
  }
  const jar = await cookies();
  jar.set(LOCALE_COOKIE, nextLocale, {
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    path: "/",
  });
  // Blow the RSC cache for every route so the next render picks up the
  // new locale. Using 'layout' scope means all pages under root layout
  // get fresh messages.
  revalidatePath("/", "layout");
}
