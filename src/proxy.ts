import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";

const ADMIN_NEXT_RE = /^\/admin(\/[A-Za-z0-9/_\-[\].]*)?(\?[A-Za-z0-9=&_\-%]*)?$/;
const DESIGNER_NEXT_RE = /^\/designer(\/[A-Za-z0-9/_\-[\].]*)?(\?[A-Za-z0-9=&_\-%]*)?$/;

/**
 * Sprint 1 — gate /admin AND /designer. Both use the same `dr_session`
 * cookie but are distinguished by the session `sub`: admin = "admin",
 * designer = "designer:<id>". Each area only accepts its own session
 * type, so a designer login can never reach /admin and vice versa.
 */
export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  const isAdmin = session?.sub === "admin";
  const isDesigner = Boolean(session?.sub?.startsWith("designer:"));

  const redirectTo = (path: string, nextCandidate?: string, nextRe?: RegExp) => {
    const url = req.nextUrl.clone();
    url.pathname = path;
    url.search = "";
    if (nextCandidate && nextRe && nextRe.test(nextCandidate)) {
      url.searchParams.set("next", nextCandidate);
    }
    return NextResponse.redirect(url);
  };

  // ── /designer area ──
  if (pathname.startsWith("/designer")) {
    const isAuthPage =
      pathname === "/designer/login" || pathname === "/designer/register";
    if (isAuthPage) {
      if (isDesigner) return redirectTo("/designer");
      return NextResponse.next();
    }
    if (!isDesigner) return redirectTo("/designer/login", pathname + search, DESIGNER_NEXT_RE);
    return NextResponse.next();
  }

  // ── /admin area ──
  if (pathname === "/admin/login") {
    if (isAdmin) return redirectTo("/admin");
    return NextResponse.next();
  }
  if (!isAdmin) return redirectTo("/admin/login", pathname + search, ADMIN_NEXT_RE);
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/designer/:path*"],
};
