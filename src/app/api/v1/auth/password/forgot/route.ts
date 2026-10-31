import { apiHandler } from "@/lib/api/handler";
import { laravel } from "@/lib/laravel-api";
import { authJsonRoute } from "@/lib/laravel/auth-json";
import { forgotPasswordSchema } from "@/features/auth/schemas";
import { requestPasswordReset } from "@/features/auth/service";

/** POST /api/v1/auth/password/forgot: always 202 (no account enumeration). */
const prismaPOST = apiHandler({ auth: "none", body: forgotPasswordSchema }, async ({ body, ip }) => {
  await requestPasswordReset(body.email, { ip });
  return { status: 202, data: { message: "If an account exists for that email, a reset link has been sent." } };
});

export const POST = authJsonRoute(
  forgotPasswordSchema,
  async (body) => {
    const { meta } = await laravel.post("auth/password/forgot", body, { auth: false });
    return { status: 202, data: { message: "If an account exists for that email, a reset link has been sent." }, requestId: meta.requestId };
  },
  prismaPOST,
);
