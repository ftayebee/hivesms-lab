import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { serializeMessage } from "@/features/public-api/serializers";

/** GET /api/v1/messages/{id}: status and event history. Other tenants' ids return 404. */
export const GET = apiHandler({ auth: "apiKey", scopes: ["messages:read"] }, async ({ params, ctx }) => {
  const id = z.uuid().safeParse(params.id);
  if (!id.success) throw new AppError("NOT_FOUND", "Message not found.");
  const m = await db.message.findFirst({ where: { id: id.data, organizationId: ctx!.organizationId }, include: { events: { orderBy: { occurredAt: "asc" } } } });
  if (!m) throw new AppError("NOT_FOUND", "Message not found.");
  return { data: serializeMessage(m) };
});
