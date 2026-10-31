import { NextResponse, type NextRequest } from "next/server";
import { GOOGLE_COOKIE, googleAuthRequest, googleProvider, safeNextPath } from "@/features/auth/google";

export const dynamic = "force-dynamic";

/** Sends the browser to Google, remembering state and the PKCE verifier in a short-lived cookie. */
export async function GET(req: NextRequest) {
  const origin = process.env.APP_URL ?? req.nextUrl.origin;
  const provider = await googleProvider();
  if (!provider) return NextResponse.redirect(new URL("/login", origin), 303);

  const { url, state, verifier } = googleAuthRequest(provider);
  const res = NextResponse.redirect(url, 303);
  res.cookies.set(GOOGLE_COOKIE, JSON.stringify({ state, verifier, next: safeNextPath(req.nextUrl.searchParams.get("next")) }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/google",
    maxAge: 600,
  });
  return res;
}
