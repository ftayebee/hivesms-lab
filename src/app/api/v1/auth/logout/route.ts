import { apiHandler } from "@/lib/api/handler";
import { endSession, getSession } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { authJsonRoute } from "@/lib/laravel/auth-json";

/** POST /api/v1/auth/logout: revokes the current session. Same-origin only. */
const prismaPOST = apiHandler({ auth: "session" }, async () => {
  await endSession();
  return { data: { signed_out: true } };
});

export const POST = authJsonRoute(
  null,
  async (_body, req) => {
    // Cookie-authenticated write: same-origin only (as apiHandler), and a session is required.
    const origin = req.headers.get("origin");
    const appHost = new URL(process.env.APP_URL ?? req.nextUrl.origin).host;
    if (!origin || (new URL(origin).host !== appHost && new URL(origin).host !== req.nextUrl.host)) throw new AppError("FORBIDDEN", "Cross-origin request rejected.");
    if (!(await getSession())) throw new AppError("UNAUTHORIZED", "Sign in to continue.");
    await endSession();
    return { data: { signed_out: true } };
  },
  prismaPOST,
);
