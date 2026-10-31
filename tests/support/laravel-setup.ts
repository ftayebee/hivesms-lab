import { afterAll } from "vitest";
import { db } from "@/lib/db";

/**
 * The cutover tests register accounts, create contacts and campaigns: they must never reach
 * production. Both the API and the database have to be local.
 */
const local = (u: string) => {
  try {
    const host = new URL(u).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost") || host.endsWith(".test");
  } catch {
    return false;
  }
};
if (!local(process.env.LARAVEL_API_URL ?? "")) throw new Error("LARAVEL_TEST_API_URL must point at a local Laravel (localhost/127.0.0.1/*.test).");
if (!local(process.env.DATABASE_URL ?? "")) throw new Error("LARAVEL_TEST_DATABASE_URL must point at a local database.");

afterAll(async () => {
  await db.$disconnect();
});
