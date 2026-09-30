import { afterAll } from "vitest";
import { db } from "@/lib/db";

// Guard against ever running destructive integration tests on a non-test database.
if (!/test/i.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("Integration tests must run against a database whose name contains 'test'.");
}

afterAll(async () => {
  await db.$disconnect();
});
