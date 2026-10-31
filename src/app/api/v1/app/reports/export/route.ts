import { apiHandler } from "@/lib/api/handler";
import { csvResponse } from "@/lib/api/csv-response";
import { parseRange } from "@/features/reports/range";
import { exportMessagesCsv, reportFiltersSchema, toMessageFilters } from "@/features/reports/messages";
import { downloadRoute, pickQuery } from "@/lib/laravel/route";

const prismaGet = apiHandler({ auth: "session", permission: "reports:export" }, async ({ ctx, req }) => {
  const sp = Object.fromEntries(req.nextUrl.searchParams);
  const csv = await exportMessagesCsv(ctx!, parseRange(sp), toMessageFilters(reportFiltersSchema.parse(sp)));
  return csvResponse(csv, "sms-report");
});

/** With the reports feature on Laravel, the filtered message log CSV is streamed from Laravel. */
export const GET = downloadRoute(
  "reports",
  (req) => ({ path: "app/reports/export", query: pickQuery(req, ["range", "from", "to", "campaign", "sender", "status", "recipient", "source"]) }),
  prismaGet,
);
