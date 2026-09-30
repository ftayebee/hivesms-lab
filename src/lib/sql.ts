import { Prisma } from "@/generated/prisma/client";
import { DHAKA_OFFSET_MINUTES } from "@/lib/format";

/**
 * SQL fragment: the Asia/Dhaka calendar day (YYYY-MM-DD) of a UTC DATETIME column.
 * Uses the fixed UTC+6 offset (no DST) so it needs no time-zone tables, which shared MySQL
 * hosting usually does not load. `column` must be a trusted identifier, never user input.
 */
export function dhakaDaySql(column: "createdAt" | "completedAt"): Prisma.Sql {
  return Prisma.raw(`DATE_FORMAT(DATE_ADD(\`${column}\`, INTERVAL ${DHAKA_OFFSET_MINUTES} MINUTE), '%Y-%m-%d')`);
}
