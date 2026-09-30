import { apiHandler } from "@/lib/api/handler";
import { forgotPasswordSchema } from "@/features/auth/schemas";
import { requestPasswordReset } from "@/features/auth/service";

/** POST /api/v1/auth/password/forgot: always 202 (no account enumeration). */
export const POST = apiHandler({ auth: "none", body: forgotPasswordSchema }, async ({ body, ip }) => {
  await requestPasswordReset(body.email, { ip });
  return { status: 202, data: { message: "If an account exists for that email, a reset link has been sent." } };
});
