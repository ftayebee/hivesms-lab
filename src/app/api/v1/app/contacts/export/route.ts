import { apiHandler } from "@/lib/api/handler";
import { csvResponse } from "@/lib/api/csv-response";
import { contactListQuery } from "@/features/contacts/schemas";
import { exportContactsCsv } from "@/features/contacts/service";
import { downloadRoute, pickQuery } from "@/lib/laravel/route";

const prismaGet = apiHandler({ auth: "session", permission: "contacts:export", query: contactListQuery.partial() }, async ({ ctx, query }) => {
  const csv = await exportContactsCsv(ctx!, query ?? {});
  return csvResponse(csv, "contacts");
});

/** Same URL either way; with the contacts feature on Laravel the CSV is streamed from Laravel. */
export const GET = downloadRoute("contacts", (req) => ({ path: "app/contacts/export", query: pickQuery(req, ["q", "group", "tag", "consent"]) }), prismaGet);
