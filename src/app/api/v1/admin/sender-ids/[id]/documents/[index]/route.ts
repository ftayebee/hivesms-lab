import { apiHandler } from "@/lib/api/handler";
import { proxyRoute } from "@/lib/laravel/route";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { getSenderIdDocument } from "@/features/sender-ids/service";

/** Staff download of sender ID documents (any tenant), audited. */
const prismaGET = apiHandler({ auth: "admin", platformPermission: "admin:sender_ids:review" }, async ({ params, session, ip }) => {
  const index = Number(params.index);
  if (!Number.isInteger(index) || index < 0 || index > 10) throw new AppError("NOT_FOUND", "Document not found.");
  const doc = await getSenderIdDocument(null, params.id, index);
  await audit({ action: "admin.sender_id.document_view", actor: { type: "ADMIN", userId: session!.user.id }, targetType: "sender_id", targetId: params.id, ip });
  return new Response(new Uint8Array(doc.body), {
    headers: { "Content-Type": doc.contentType, "Content-Disposition": `attachment; filename="${doc.name.replace(/"/g, "")}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" },
  });
});

/** LARAVEL_FEATURES `admin`: answered by the Laravel admin API (platform permission enforced there). */
export const GET = proxyRoute("admin", (p) => `admin/sender-ids/${encodeURIComponent(p.id)}/documents/${encodeURIComponent(p.index)}`, prismaGET, { session: true });
