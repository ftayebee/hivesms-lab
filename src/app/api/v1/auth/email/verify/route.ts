import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { laravel } from "@/lib/laravel-api";
import { authJsonRoute } from "@/lib/laravel/auth-json";
import { RateLimits } from "@/lib/rate-limit";
import { verifyEmailToken } from "@/features/auth/service";

/** POST /api/v1/auth/email/verify: confirms an email verification token. */
const prismaPOST = apiHandler({ auth: "none", body: z.object({ token: z.string().min(20).max(200) }), rateLimit: RateLimits.passwordResetPerIp }, async ({ body }) => {
  await verifyEmailToken(body.token);
  return { data: { email_verified: true } };
});

export const POST = authJsonRoute(
  z.object({ token: z.string().min(20).max(200) }),
  async (body) => {
    const { meta } = await laravel.post("auth/email/verify", body, { auth: false });
    return { data: { email_verified: true }, requestId: meta.requestId };
  },
  prismaPOST,
);
