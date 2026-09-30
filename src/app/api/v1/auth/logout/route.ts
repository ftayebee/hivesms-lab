import { apiHandler } from "@/lib/api/handler";
import { endSession } from "@/lib/auth/session";

/** POST /api/v1/auth/logout: revokes the current session. Same-origin only. */
export const POST = apiHandler({ auth: "session" }, async () => {
  await endSession();
  return { data: { signed_out: true } };
});
