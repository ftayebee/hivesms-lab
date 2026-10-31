import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { isLaravelApiError, laravelData } from "@/lib/laravel-api";
import { laravelEnabled } from "@/lib/laravel/flags";
import { logger } from "@/lib/logger";

/**
 * Sign in with Google. This server handles the browser redirects and the state check; Laravel
 * exchanges the code, so the client secret stays there. Without the Laravel `auth` feature or
 * Google credentials on the API, `googleProvider` is null and the button is not shown.
 */
export const GOOGLE_COOKIE = "sf_google";

export interface GoogleProvider {
  clientId: string;
  redirectUri: string;
}

export async function googleProvider(): Promise<GoogleProvider | null> {
  if (!laravelEnabled("auth")) return null;
  try {
    const { google } = await laravelData<{ google: GoogleProvider | null }>("auth/providers", undefined, { auth: false });
    return google;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "sign-in providers unavailable");
    return null;
  }
}

export function safeNextPath(next: unknown): string | undefined {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : undefined;
}

export function googleAuthRequest(provider: GoogleProvider) {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: provider.clientId,
    redirect_uri: provider.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return { url: url.toString(), state, verifier };
}

/** Reason shown on the login page. A fixed list, so the URL cannot put arbitrary text on the page. */
export const GOOGLE_ERRORS = {
  cancelled: "Google sign-in was cancelled.",
  expired: "That sign-in attempt expired. Please try again.",
  refused: "This account can't sign in with Google. Use your password, or contact support.",
  limited: "Too many attempts. Wait a few minutes and try again.",
  failed: "We couldn't sign you in with Google. Please try again.",
} as const;

export function googleErrorReason(err: unknown): keyof typeof GOOGLE_ERRORS {
  if (!isLaravelApiError(err)) return "failed";
  if (err.kind === "forbidden") return "refused";
  return err.kind === "rate_limited" ? "limited" : "failed";
}
