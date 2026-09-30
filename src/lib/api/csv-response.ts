import { dhakaDateKey } from "@/lib/format";

/** CSV download response with a safe, dated filename. */
export function csvResponse(csv: string, basename: string) {
  const safe = basename.replace(/[^a-z0-9-]/gi, "-").slice(0, 60);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safe}-${dhakaDateKey(new Date())}.csv"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
