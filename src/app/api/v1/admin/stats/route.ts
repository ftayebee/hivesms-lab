import { apiHandler } from "@/lib/api/handler";
import { proxyRoute } from "@/lib/laravel/route";
import { getAdminOverview } from "@/features/admin/overview";

/** GET /api/v1/admin/stats: platform metrics for staff (session + platform role). */
const prismaGET = apiHandler({ auth: "admin", platformPermission: "admin:access" }, async () => {
  const o = await getAdminOverview();
  return {
    data: {
      users: o.users,
      active_users_30d: o.activeUsers,
      organizations: o.orgs,
      suspended_organizations: o.suspendedOrgs,
      sms_today: o.smsToday,
      sms_30d: o.sms30,
      failed_messages_24h: o.failed24,
      revenue_30d: o.revenue30.toFixed(2),
      pending_sender_ids: o.pendingSenders,
      pending_payments: o.pendingPayments,
      campaigns_in_review: o.reviewCampaigns,
      open_tickets: o.openTickets,
      api_requests_24h: o.api24,
    },
  };
});

/** LARAVEL_FEATURES `admin`: answered by the Laravel admin API (platform permission enforced there). */
export const GET = proxyRoute("admin", () => "admin/stats", prismaGET, { session: true });
