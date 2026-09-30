import { apiHandler } from "@/lib/api/handler";
import { AppError } from "@/lib/errors";
import { getSenderIdDocument } from "@/features/sender-ids/service";

export const GET = apiHandler({ auth: "session", permission: "sender_ids:read" }, async ({ ctx, params }) => {
  const index = Number(params.index);
  if (!Number.isInteger(index) || index < 0 || index > 10) throw new AppError("NOT_FOUND", "Document not found.");
  const doc = await getSenderIdDocument(ctx!.organizationId, params.id, index);
  return new Response(new Uint8Array(doc.body), {
    headers: {
      "Content-Type": doc.contentType,
      "Content-Disposition": `attachment; filename="${doc.name.replace(/"/g, "")}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
});
