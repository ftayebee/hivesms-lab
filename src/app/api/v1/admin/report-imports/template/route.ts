import { optInDownload } from "@/lib/laravel/optin-download";

/** CSV template for the admin report import (docs/24). Laravel checks admin:reports:import. */
export const GET = optInDownload("reportImport", () => "admin/report-imports/template");
