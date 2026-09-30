import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { RateLimits } from "@/lib/rate-limit";
import { verifyEmailToken } from "@/features/auth/service";

/** POST /api/v1/auth/email/verify: confirms an email verification token. */
export const POST = apiHandler({ auth: "none", body: z.object({ token: z.string().min(20).max(200) }), rateLimit: RateLimits.passwordResetPerIp }, async ({ body }) => {
  await verifyEmailToken(body.token);
  return { data: { email_verified: true } };
});
