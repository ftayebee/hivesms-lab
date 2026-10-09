import { apiHandler } from "@/lib/api/handler";
import { AppError } from "@/lib/errors";
import { getSenderIdDocument } from "@/features/sender-ids/service";
import { downloadRoute } from "@/lib/laravel/route";

const prismaGet = apiHandler({ auth: "session", permission: "sender_ids:read" }, async ({ ctx, params }) => {
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

/** With the senderIds feature on Laravel, the document is streamed from Laravel (tenant-checked there). */
export const GET = downloadRoute("senderIds", (_req, p) => ({ path: `app/sender-ids/${encodeURIComponent(p.id)}/documents/${encodeURIComponent(p.index)}` }), prismaGet);
