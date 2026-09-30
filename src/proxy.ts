import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic auth gate. Proxy only checks that a session cookie exists, so signed-out
 * visitors are redirected before any rendering work. It is NOT the security boundary: every
 * layout, page, server action and route handler validates the session against the database
 * and checks permissions itself.
 */
const SESSION_COOKIES = ["__Host-sf_session", "sf_session"];

export function proxy(request: NextRequest) {
  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (!hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*", "/onboarding"],
};
