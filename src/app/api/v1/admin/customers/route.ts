import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { proxyRoute } from "@/lib/laravel/route";
import { listOrganizations } from "@/features/admin/service";

const query = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

/** GET /api/v1/admin/customers: paginated organizations. */
const prismaGET = apiHandler({ auth: "admin", platformPermission: "admin:customers:read", query }, async ({ query: q }) => {
  const { rows, total } = await listOrganizations({ q: q.q, status: q.status, page: q.page });
  return {
    data: rows.map((o) => ({
      id: o.id,
      name: o.name,
      status: o.status,
      plan: o.pricingPlan?.name ?? null,
      balance: o.wallet?.balance.toFixed(2) ?? "0.00",
      members: o._count.members,
      messages: o._count.messages,
      daily_send_limit: o.dailySendLimit,
      created_at: o.createdAt.toISOString(),
    })),
    meta: { total, page: q.page },
  };
});

/** LARAVEL_FEATURES `admin`: answered by the Laravel admin API (platform permission enforced there). */
export const GET = proxyRoute("admin", () => "admin/customers", prismaGET, { session: true });
