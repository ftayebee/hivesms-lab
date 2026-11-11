import { optInDownload } from "@/lib/laravel/optin-download";

/** Staff view of a payment proof; Laravel checks admin:topups:review and audits the view. */
export const GET = optInDownload<{ id: string }>("manualTopups", (p) => `admin/topup-requests/${encodeURIComponent(p.id)}/proof`);
