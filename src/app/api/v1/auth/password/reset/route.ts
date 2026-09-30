import { apiHandler } from "@/lib/api/handler";
import { RateLimits } from "@/lib/rate-limit";
import { resetPasswordSchema } from "@/features/auth/schemas";
import { resetPassword } from "@/features/auth/service";

/** POST /api/v1/auth/password/reset: consumes a reset token; all sessions are revoked. */
export const POST = apiHandler({ auth: "none", body: resetPasswordSchema, rateLimit: RateLimits.passwordResetPerIp }, async ({ body, ip, req }) => {
  await resetPassword(body.token, body.password, { ip, userAgent: req.headers.get("user-agent") });
  return { data: { password_reset: true } };
});
