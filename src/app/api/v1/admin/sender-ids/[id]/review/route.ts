import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { proxyRoute } from "@/lib/laravel/route";
import { requireAdminContext } from "@/features/admin/guard";
import { reviewSenderId } from "@/features/admin/service";

/** POST /api/v1/admin/sender-ids/{id}/review: approve, reject or suspend a sender ID. */
const prismaPOST = apiHandler(
  {
    auth: "admin",
    platformPermission: "admin:sender_ids:review",
    body: z.object({ decision: z.enum(["APPROVED", "REJECTED", "SUSPENDED"]), reason: z.string().trim().max(500).optional(), provider_ref: z.string().trim().max(100).optional() }),
  },
  async ({ params, body }) => {
    const admin = await requireAdminContext("admin:sender_ids:review");
    await reviewSenderId(admin, z.uuid().parse(params.id), body.decision, body.reason ?? null, body.provider_ref ?? null);
    return { data: { id: params.id, status: body.decision } };
  },
);

/** LARAVEL_FEATURES `admin`: answered by the Laravel admin API (platform permission enforced there). */
export const POST = proxyRoute("admin", (p) => `admin/sender-ids/${encodeURIComponent(p.id)}/review`, prismaPOST, { session: true });
