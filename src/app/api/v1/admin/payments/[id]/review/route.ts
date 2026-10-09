import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { proxyRoute } from "@/lib/laravel/route";
import { requireAdminContext } from "@/features/admin/guard";
import { reviewManualPayment } from "@/features/admin/service";

/** POST /api/v1/admin/payments/{id}/review: verify (credit) or reject a manual payment. */
const prismaPOST = apiHandler(
  { auth: "admin", platformPermission: "admin:billing:manage", body: z.object({ decision: z.enum(["approve", "reject"]), reason: z.string().trim().max(500).optional() }) },
  async ({ params, body }) => {
    const admin = await requireAdminContext("admin:billing:manage");
    await reviewManualPayment(admin, z.uuid().parse(params.id), body.decision, body.reason ?? null);
    return { data: { id: params.id, decision: body.decision } };
  },
);

/** LARAVEL_FEATURES `admin`: answered by the Laravel admin API (platform permission enforced there). */
export const POST = proxyRoute("admin", (p) => `admin/payments/${encodeURIComponent(p.id)}/review`, prismaPOST, { session: true });
