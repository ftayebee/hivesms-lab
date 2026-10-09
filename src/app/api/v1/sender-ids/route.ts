import { apiHandler } from "@/lib/api/handler";
import { proxyRoute } from "@/lib/laravel/route";
import { db } from "@/lib/db";

/** GET /api/v1/sender-ids: sender IDs of the account with status. */
const prismaGET = apiHandler({ auth: "apiKey", scopes: ["sender_ids:read"] }, async ({ ctx }) => {
  const rows = await db.senderId.findMany({ where: { organizationId: ctx!.organizationId }, orderBy: [{ isDefault: "desc" }, { value: "asc" }] });
  return {
    data: rows.map((s) => ({
      sender_id: s.value,
      type: s.type === "MASKING" ? "masking" : "non_masking",
      status: s.status.toLowerCase(),
      default: s.isDefault && s.status === "APPROVED",
      approved_at: s.approvedAt?.toISOString() ?? null,
      rejection_reason: s.status === "REJECTED" ? s.rejectionReason : null,
    })),
  };
});

/** LARAVEL_FEATURES `publicApi`: the same request (API key, body, Idempotency-Key) is answered by Laravel. */
export const GET = proxyRoute("publicApi", () => "sender-ids", prismaGET);
