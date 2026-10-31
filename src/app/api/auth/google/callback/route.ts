import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { GOOGLE_COOKIE, GOOGLE_ERRORS, googleErrorReason, safeNextPath } from "@/features/auth/google";
import { startLaravelSession } from "@/lib/auth/session";
import { laravel } from "@/lib/laravel-api";
import type { LaravelIssuedSession } from "@/lib/laravel/session";

export const dynamic = "force-dynamic";

function sameState(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function readCookie(value: string | undefined): { state?: unknown; verifier?: unknown; next?: unknown } {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

/** Google returns here. Checks state, has Laravel exchange the code, then starts the session. */
export async function GET(req: NextRequest) {
  const origin = process.env.APP_URL ?? req.nextUrl.origin;
  const back = (reason: keyof typeof GOOGLE_ERRORS) => NextResponse.redirect(new URL(`/login?google=${reason}`, origin), 303);
  const params = req.nextUrl.searchParams;
  const jar = await cookies();
  const saved = readCookie(jar.get(GOOGLE_COOKIE)?.value);
  jar.delete({ name: GOOGLE_COOKIE, path: "/api/auth/google" });

  if (params.get("error")) return back("cancelled");
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state || typeof saved.state !== "string" || typeof saved.verifier !== "string" || !sameState(saved.state, state)) return back("expired");

  let destination: string;
  try {
    const { data } = await laravel.post<LaravelIssuedSession & { created: boolean }>("auth/google", { code, codeVerifier: saved.verifier }, { auth: false });
    await startLaravelSession(data);
    destination = data.created ? "/dashboard?welcome=1" : (safeNextPath(saved.next) ?? "/dashboard");
  } catch (err) {
    return back(googleErrorReason(err));
  }
  return NextResponse.redirect(new URL(destination, origin), 303);
}
