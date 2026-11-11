import "server-only";
import type { NextRequest } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { isLaravelApiError, laravelDownload } from "@/lib/laravel-api";
import { laravelEnabled, type OptInFeature } from "@/lib/laravel/flags";

type Params = Record<string, string>;

/**
 * Same-origin download for a Laravel-only module (template CSV, payment proof, QR image): the
 * browser's session cookie becomes the Bearer token server-side; Laravel checks permission and
 * tenant scope. 404 while the module is off.
 */
export function optInDownload<P extends Params = Params>(feature: OptInFeature, path: (params: P) => string) {
  return async (_req: NextRequest, ctx: { params: Promise<P> }): Promise<Response> => {
    if (!laravelEnabled(feature)) return new Response("Not found", { status: 404 });
    try {
      return await laravelDownload(path(await ctx.params));
    } catch (err) {
      unstable_rethrow(err);
      const status = isLaravelApiError(err) ? err.status : 503;
      return Response.json({ success: false, error: { code: isLaravelApiError(err) ? err.code : "UNAVAILABLE", message: isLaravelApiError(err) ? err.userMessage : "Unavailable" } }, { status });
    }
  };
}
