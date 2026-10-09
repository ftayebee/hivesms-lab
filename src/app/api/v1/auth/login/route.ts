import { apiHandler } from "@/lib/api/handler";
import { RateLimits } from "@/lib/rate-limit";
import { startLaravelSession, startSession } from "@/lib/auth/session";
import { laravel } from "@/lib/laravel-api";
import { authJsonRoute } from "@/lib/laravel/auth-json";
import type { LaravelIssuedSession } from "@/lib/laravel/session";
import { defaultOrganizationFor } from "@/lib/auth/session-store";
import { loginSchema } from "@/features/auth/schemas";
import { authenticate } from "@/features/auth/service";

/** POST /api/v1/auth/login: sets the session cookie (for first-party apps). */
const prismaPOST = apiHandler({ auth: "none", body: loginSchema, rateLimit: RateLimits.loginPerIp }, async ({ body, ip, req }) => {
  const user = await authenticate(body.identifier, body.password, { ip, userAgent: req.headers.get("user-agent") });
  const orgId = await defaultOrganizationFor(user.id);
  await startSession(user.id, orgId, body.remember);
  return { data: { user: { id: user.id, name: user.name, email: user.email, email_verified: Boolean(user.emailVerifiedAt) }, organization_id: orgId } };
});

/** LARAVEL_FEATURES `auth`: Laravel authenticates; the session cookie is set here as before. */
export const POST = authJsonRoute(
  loginSchema,
  async (body) => {
    const { data, meta } = await laravel.post<LaravelIssuedSession>("auth/login", body, { auth: false });
    await startLaravelSession(data);
    return {
      data: { user: { id: data.user.id, name: data.user.name, email: data.user.email, email_verified: Boolean(data.user.emailVerifiedAt) }, organization_id: data.organizationId },
      requestId: meta.requestId,
    };
  },
  prismaPOST,
);
