import { optInDownload } from "@/lib/laravel/optin-download";

export const GET = optInDownload("dynamicSms", () => "app/dynamic-sms/template");
