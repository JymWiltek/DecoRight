import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (pathname === "/admin/login") {
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    const session = await verifySession(token);
    if (session) {
      const url = req.nextUrl.clone();
      url.pathname = "/admin";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = "";
    // Only preserve `next` if the originally requested path is a clean
    // ASCII admin route — otherwise drop it so a malformed URL can't
    // survive the login round-trip and 404 the user after sign-in.
    const candidate = pathname + search;
    if (/^\/admin(\/[A-Za-z0-9/_\-[\].]*)?(\?[A-Za-z0-9=&_\-%]*)?$/.test(candidate)) {
      url.searchParams.set("next", candidate);
    }
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
