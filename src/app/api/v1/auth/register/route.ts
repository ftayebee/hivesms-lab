import { apiHandler } from "@/lib/api/handler";
import { RateLimits } from "@/lib/rate-limit";
import { startLaravelSession, startSession } from "@/lib/auth/session";
import { laravel } from "@/lib/laravel-api";
import { authJsonRoute } from "@/lib/laravel/auth-json";
import type { LaravelIssuedSession } from "@/lib/laravel/session";
import { registerSchema } from "@/features/auth/schemas";
import { registerAccount } from "@/features/auth/service";

/** POST /api/v1/auth/register: creates the user + organization and signs in. */
const prismaPOST = apiHandler({ auth: "none", body: registerSchema, rateLimit: RateLimits.registerPerIp }, async ({ body, ip, req }) => {
  const { userId, organizationId } = await registerAccount(body, { ip, userAgent: req.headers.get("user-agent") });
  await startSession(userId, organizationId, false);
  return { status: 201, data: { user_id: userId, organization_id: organizationId, email_verification_sent: true } };
});

export const POST = authJsonRoute(
  registerSchema,
  async (body) => {
    const { data, meta } = await laravel.post<LaravelIssuedSession>("auth/register", body, { auth: false });
    await startLaravelSession(data);
    return { status: 201, data: { user_id: data.user.id, organization_id: data.organizationId, email_verification_sent: true }, requestId: meta.requestId };
  },
  prismaPOST,
);
