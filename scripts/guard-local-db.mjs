// Refuses to continue unless DATABASE_URL points at a local database and NODE_ENV is not
// production. Used in front of destructive commands such as `prisma migrate reset`.
import "dotenv/config";

const raw = process.env.DATABASE_URL ?? "";
let host = "";
try {
  host = new URL(raw).hostname;
} catch {}
const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
if (process.env.NODE_ENV === "production" || !local) {
  console.error(`Refusing to run: this command wipes the database and is for local development only (host: ${host || "unknown"}).`);
  console.error("For production use `npm run db:deploy` (prisma migrate deploy).");
  process.exit(1);
}
