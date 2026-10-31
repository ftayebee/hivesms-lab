import { downloadRoute, pickQuery } from "@/lib/laravel/route";

/**
 * GET /api/v1/admin/exports/{kind}?range=&from=&to= — admin CSV exports, streamed from Laravel with the
 * staff session (BFF: the browser never calls Laravel). Laravel enforces `admin:reports:export` plus the
 * data's own read permission, minimises personal data, escapes CSV formulas and audits each export.
 * There is no Prisma implementation: without LARAVEL_FEATURES `admin` the route answers 404.
 */
const notAvailable = async () =>
  Response.json({ success: false, error: { code: "NOT_FOUND", message: "Exports need the Laravel admin API (LARAVEL_FEATURES admin)." }, meta: {} }, { status: 404 });

export const GET = downloadRoute<{ kind: string }>(
  "admin",
  (req, p) => ({ path: `admin/exports/${encodeURIComponent(p.kind)}`, query: pickQuery(req, ["range", "from", "to"]) }),
  notAvailable,
);
