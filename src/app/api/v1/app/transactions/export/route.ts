import { apiHandler } from "@/lib/api/handler";
import { csvResponse } from "@/lib/api/csv-response";
import { parseRange } from "@/features/reports/range";
import { exportTransactionsCsv, txFilterSchema } from "@/features/wallet/service";
import { downloadRoute, pickQuery } from "@/lib/laravel/route";

const prismaGet = apiHandler({ auth: "session", permission: "billing:read" }, async ({ ctx, req }) => {
  const sp = Object.fromEntries(req.nextUrl.searchParams);
  const csv = await exportTransactionsCsv(ctx!, parseRange(sp, "90d"), txFilterSchema.parse(sp));
  return csvResponse(csv, "wallet-transactions");
});

/** With the wallet feature on Laravel, the ledger CSV is streamed from Laravel. */
export const GET = downloadRoute("wallet", (req) => ({ path: "app/wallet/transactions/export", query: pickQuery(req, ["range", "from", "to", "type", "reason"]) }), prismaGet);
