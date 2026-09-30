import { apiHandler } from "@/lib/api/handler";
import { RateLimits } from "@/lib/rate-limit";
import { startSession } from "@/lib/auth/session";
import { registerSchema } from "@/features/auth/schemas";
import { registerAccount } from "@/features/auth/service";

/** POST /api/v1/auth/register: creates the user + organization and signs in. */
export const POST = apiHandler({ auth: "none", body: registerSchema, rateLimit: RateLimits.registerPerIp }, async ({ body, ip, req }) => {
  const { userId, organizationId } = await registerAccount(body, { ip, userAgent: req.headers.get("user-agent") });
  await startSession(userId, organizationId, false);
  return { status: 201, data: { user_id: userId, organization_id: organizationId, email_verification_sent: true } };
});
