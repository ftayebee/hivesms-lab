import { apiHandler } from "@/lib/api/handler";
import { RateLimits } from "@/lib/rate-limit";
import { startSession } from "@/lib/auth/session";
import { defaultOrganizationFor } from "@/lib/auth/session-store";
import { loginSchema } from "@/features/auth/schemas";
import { authenticate } from "@/features/auth/service";

/** POST /api/v1/auth/login: sets the session cookie (for first-party apps). */
export const POST = apiHandler({ auth: "none", body: loginSchema, rateLimit: RateLimits.loginPerIp }, async ({ body, ip, req }) => {
  const user = await authenticate(body.identifier, body.password, { ip, userAgent: req.headers.get("user-agent") });
  const orgId = await defaultOrganizationFor(user.id);
  await startSession(user.id, orgId, body.remember);
  return { data: { user: { id: user.id, name: user.name, email: user.email, email_verified: Boolean(user.emailVerifiedAt) }, organization_id: orgId } };
});
