import { optInDownload } from "@/lib/laravel/optin-download";

export const GET = optInDownload<{ id: string }>("manualTopups", (p) => `admin/payment-methods/${encodeURIComponent(p.id)}/qr`);
