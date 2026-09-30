import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { requireAdminContext } from "@/features/admin/guard";
import { reviewManualPayment } from "@/features/admin/service";

/** POST /api/v1/admin/payments/{id}/review: verify (credit) or reject a manual payment. */
export const POST = apiHandler(
  { auth: "admin", platformPermission: "admin:billing:manage", body: z.object({ decision: z.enum(["approve", "reject"]), reason: z.string().trim().max(500).optional() }) },
  async ({ params, body }) => {
    const admin = await requireAdminContext("admin:billing:manage");
    await reviewManualPayment(admin, z.uuid().parse(params.id), body.decision, body.reason ?? null);
    return { data: { id: params.id, decision: body.decision } };
  },
);
