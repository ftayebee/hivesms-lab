import { apiHandler } from "@/lib/api/handler";
import { csvResponse } from "@/lib/api/csv-response";
import { exportCampaignReport } from "@/features/campaigns/service";

export const GET = apiHandler({ auth: "session", permission: "reports:export" }, async ({ ctx, params }) => {
  const { csv, name } = await exportCampaignReport(ctx!, params.id);
  return csvResponse(csv, `campaign-${name.toLowerCase()}`);
});
