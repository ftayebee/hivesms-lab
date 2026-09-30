import { execSync } from "node:child_process";
import { config } from "dotenv";

/** Applies migrations to the dedicated test database once before integration tests. */
export default function setup() {
  config();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set. Integration tests need a separate MySQL/MariaDB database (see .env.example).");
  if (url === process.env.DATABASE_URL) throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL: integration tests wipe the database.");
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
}
