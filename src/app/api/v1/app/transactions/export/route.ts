import { apiHandler } from "@/lib/api/handler";
import { csvResponse } from "@/lib/api/csv-response";
import { parseRange } from "@/features/reports/range";
import { exportTransactionsCsv, txFilterSchema } from "@/features/wallet/service";

export const GET = apiHandler({ auth: "session", permission: "billing:read" }, async ({ ctx, req }) => {
  const sp = Object.fromEntries(req.nextUrl.searchParams);
  const csv = await exportTransactionsCsv(ctx!, parseRange(sp, "90d"), txFilterSchema.parse(sp));
  return csvResponse(csv, "wallet-transactions");
});
