import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { requireAdminContext } from "@/features/admin/guard";
import { setOrganizationStatus } from "@/features/admin/service";

/** POST /api/v1/admin/customers/{id}/status: suspend or reactivate an organization. */
export const POST = apiHandler(
  { auth: "admin", platformPermission: "admin:customers:manage", body: z.object({ status: z.enum(["ACTIVE", "SUSPENDED"]), reason: z.string().trim().max(500).optional() }) },
  async ({ params, body }) => {
    const admin = await requireAdminContext("admin:customers:manage");
    await setOrganizationStatus(admin, z.uuid().parse(params.id), body.status, body.reason ?? null);
    return { data: { id: params.id, status: body.status } };
  },
);
