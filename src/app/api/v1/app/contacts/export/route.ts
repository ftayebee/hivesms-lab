import { apiHandler } from "@/lib/api/handler";
import { csvResponse } from "@/lib/api/csv-response";
import { contactListQuery } from "@/features/contacts/schemas";
import { exportContactsCsv } from "@/features/contacts/service";

export const GET = apiHandler({ auth: "session", permission: "contacts:export", query: contactListQuery.partial() }, async ({ ctx, query }) => {
  const csv = await exportContactsCsv(ctx!, query ?? {});
  return csvResponse(csv, "contacts");
});
