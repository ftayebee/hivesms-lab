import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

// Local development: load .env with Node's built-in loader (no dotenv dependency, so this file
// also loads when devDependencies are not installed). Variables already set by the host
// (Vercel, Docker, CI) take precedence; on those hosts there is usually no .env file at all.
if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Read directly instead of env("DATABASE_URL"): `prisma generate` never connects, so builds
    // must not fail when DATABASE_URL is unset. migrate/db commands still require it.
    url: process.env.DATABASE_URL,
  },
});
