import "server-only";
import type { NextRequest } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { ZodError, type z, type ZodType } from "zod";
import { isLaravelApiError } from "@/lib/laravel-api";
import { laravelEnabled } from "@/lib/laravel/flags";
import { logger } from "@/lib/logger";

/**
 * First-party JSON auth endpoints (/api/v1/auth/*) when LARAVEL_FEATURES has `auth`: the request is
 * validated with the same schema, Laravel does the work, and the response keeps this route's
 * existing snake_case contract and envelope. Cookie handling stays on this origin.
 */

type RouteHandler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

function envelope(body: Record<string, unknown>, status: number, requestId?: unknown) {
  return Response.json({ ...body, meta: { requestId: typeof requestId === "string" ? requestId : null } }, { status, headers: { "Cache-Control": "no-store" } });
}

export function authJsonRoute<S extends ZodType | null>(
  schema: S,
  run: (body: S extends ZodType ? z.infer<S> : undefined, req: NextRequest) => Promise<{ status?: number; data: unknown; requestId?: unknown }>,
  prismaHandler: RouteHandler,
): RouteHandler {
  return async (req, ctx) => {
    if (!laravelEnabled("auth")) return prismaHandler(req, ctx);
    try {
      let body: unknown;
      if (schema) {
        const raw = await req.json().catch(() => {
          throw new ZodError([{ code: "custom", path: [], message: "Send a JSON body.", input: undefined }]);
        });
        body = schema.parse(raw);
      }
      const r = await run(body as S extends ZodType ? z.infer<S> : undefined, req);
      return envelope({ success: true, data: r.data }, r.status ?? 200, r.requestId);
    } catch (err) {
      unstable_rethrow(err);
      if (err instanceof ZodError) {
        return envelope(
          { success: false, error: { code: "VALIDATION_ERROR", message: "The request is invalid.", details: { fields: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } } },
          422,
        );
      }
      if (isLaravelApiError(err)) {
        return envelope(
          { success: false, error: { code: err.code ?? "INVALID_REQUEST", message: err.userMessage, ...(err.details && err.status < 500 ? { details: err.details } : {}) } },
          err.status >= 500 ? (err.kind === "unavailable" ? 503 : 500) : err.status,
          err.requestId,
        );
      }
      logger.error({ err }, "auth json route failed");
      return envelope({ success: false, error: { code: "INTERNAL_ERROR", message: "Something went wrong on our side. Retry, and contact support if it persists." } }, 500);
    }
  };
}
