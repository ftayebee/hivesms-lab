import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against a production build with the mock SMS and
 * payment providers and the console email driver (emails land in .local/mailbox).
 * The in-process worker (WORKER_IN_PROCESS=true) dispatches and delivers.
 *
 *   npx prisma migrate deploy   # against a local MySQL/MariaDB (DATABASE_URL in .env)
 *   npm run build
 *   npm run test:e2e        # starts `next start` on :3210 (E2E_PORT) unless E2E_BASE_URL is set
 *
 * E2E_BASE_URL may point at a staging deployment that uses the mock providers.
 * Never point it at production: the journey registers accounts and buys credits.
 */
const PORT = Number(process.env.E2E_PORT ?? 3210);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run start",
        url: `${baseURL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: { PORT: String(PORT), APP_URL: baseURL, ALLOW_MOCK_PAYMENTS: "true", WORKER_IN_PROCESS: "true" },
      },
});
