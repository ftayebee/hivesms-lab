import { apiHandler } from "@/lib/api/handler";
import { csvResponse } from "@/lib/api/csv-response";
import { parseRange } from "@/features/reports/range";
import { exportMessagesCsv, reportFiltersSchema, toMessageFilters } from "@/features/reports/messages";

export const GET = apiHandler({ auth: "session", permission: "reports:export" }, async ({ ctx, req }) => {
  const sp = Object.fromEntries(req.nextUrl.searchParams);
  const csv = await exportMessagesCsv(ctx!, parseRange(sp), toMessageFilters(reportFiltersSchema.parse(sp)));
  return csvResponse(csv, "sms-report");
});
