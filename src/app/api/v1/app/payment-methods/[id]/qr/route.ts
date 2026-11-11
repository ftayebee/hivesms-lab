import { optInDownload } from "@/lib/laravel/optin-download";

export const GET = optInDownload<{ id: string }>("manualTopups", (p) => `app/payment-methods/${encodeURIComponent(p.id)}/qr`);
