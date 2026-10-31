import type { Prisma } from "@/generated/prisma/client";
import type { MessageStatus } from "@/generated/prisma/enums";
import { apiHandler } from "@/lib/api/handler";
import { proxyRoute } from "@/lib/laravel/route";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { normalizeBdPhone } from "@/lib/phone";
import { serializeMessage } from "@/features/public-api/serializers";
import { listMessagesQuery } from "@/features/public-api/schemas";

/** Opaque cursor = base64url("<createdAt ISO>|<id>") for stable keyset pagination. */
function decodeCursor(c: string) {
  try {
    const [at, id] = Buffer.from(c, "base64url").toString("utf8").split("|");
    const d = new Date(at);
    if (isNaN(d.getTime()) || !id) throw new Error();
    return { at: d, id };
  } catch {
    throw new AppError("INVALID_REQUEST", "Invalid cursor.");
  }
}

/** GET /api/v1/messages: newest first, cursor-paginated. */
const prismaGET = apiHandler({ auth: "apiKey", scopes: ["messages:read"], query: listMessagesQuery }, async ({ query, ctx }) => {
  const where: Prisma.MessageWhereInput = { organizationId: ctx!.organizationId };
  if (query.status) where.status = query.status.toUpperCase() as MessageStatus;
  if (query.to) where.to = normalizeBdPhone(query.to) ?? query.to;
  if (query.reference) where.clientReference = query.reference;
  if (query.from || query.until) where.createdAt = { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.until ? { lt: new Date(new Date(query.until).getTime() + 86_400_000) } : {}) };
  if (query.cursor) {
    const c = decodeCursor(query.cursor);
    where.AND = [{ OR: [{ createdAt: { lt: c.at } }, { createdAt: c.at, id: { lt: c.id } }] }];
  }
  const rows = await db.message.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: query.limit + 1 });
  const hasMore = rows.length > query.limit;
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  return {
    data: page.map((m) => serializeMessage(m)),
    meta: { hasMore, nextCursor: hasMore && last ? Buffer.from(`${last.createdAt.toISOString()}|${last.id}`).toString("base64url") : null },
  };
});

/** LARAVEL_FEATURES `publicApi`: the same request (API key, body, Idempotency-Key) is answered by Laravel. */
export const GET = proxyRoute("publicApi", () => "messages", prismaGET);
