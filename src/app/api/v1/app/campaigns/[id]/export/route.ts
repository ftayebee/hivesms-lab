import { apiHandler } from "@/lib/api/handler";
import { csvResponse } from "@/lib/api/csv-response";
import { exportCampaignReport } from "@/features/campaigns/service";
import { downloadRoute } from "@/lib/laravel/route";

const prismaGet = apiHandler({ auth: "session", permission: "reports:export" }, async ({ ctx, params }) => {
  const { csv, name } = await exportCampaignReport(ctx!, params.id);
  return csvResponse(csv, `campaign-${name.toLowerCase()}`);
});

/** With the campaigns feature on Laravel, the per-recipient report is streamed from Laravel. */
export const GET = downloadRoute("campaigns", (_req, p) => ({ path: `app/campaigns/${encodeURIComponent(p.id)}/export` }), prismaGet);
