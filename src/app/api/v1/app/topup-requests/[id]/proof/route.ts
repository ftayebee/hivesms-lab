import { optInDownload } from "@/lib/laravel/optin-download";

export const GET = optInDownload<{ id: string }>("manualTopups", (p) => `app/topup-requests/${encodeURIComponent(p.id)}/proof`);
