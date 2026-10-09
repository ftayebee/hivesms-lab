import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

loadEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const alias = {
  "@": path.resolve(__dirname, "src"),
  // Next.js-only guard module; a no-op outside the Next.js bundler.
  "server-only": path.resolve(__dirname, "tests/support/empty.ts"),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          env: { LOG_LEVEL: "silent" },
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        // Frontend ↔ Laravel cutover checks against a LOCAL Laravel API and database
        // (LARAVEL_TEST_API_URL, LARAVEL_TEST_DATABASE_URL). Refuses non-local targets.
        resolve: { alias },
        test: {
          name: "laravel",
          include: ["tests/laravel/**/*.test.ts"],
          environment: "node",
          fileParallelism: false,
          testTimeout: 60_000,
          // beforeAll registers accounts and tops up wallets through the API.
          hookTimeout: 120_000,
          setupFiles: ["tests/support/laravel-setup.ts"],
          env: {
            DATABASE_URL: process.env.LARAVEL_TEST_DATABASE_URL ?? "",
            LARAVEL_API_URL: process.env.LARAVEL_TEST_API_URL ?? "",
            LARAVEL_FEATURES: "all",
            LOG_LEVEL: "silent",
            NODE_ENV: "test",
          },
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          // One real MySQL/MariaDB test database; files run sequentially and reset it.
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 120_000,
          globalSetup: ["tests/support/global-setup.ts"],
          setupFiles: ["tests/support/integration-setup.ts"],
          env: {
            DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
            // The app default (lib/db.ts). A small pool from the developer's .env starves the concurrency
            // tests (P2028 "Unable to start a transaction in the given time"), which test deadlocks, not pool size.
            DATABASE_POOL_SIZE: "10",
            SMS_PROVIDER: "mock",
            // Test-only value: the webhook signature tests must not depend on the developer's .env
            // (without a secret the mock provider accepts unsigned webhooks outside production).
            SMS_PROVIDER_WEBHOOK_SECRET: "integration-test-webhook-secret-not-for-production",
            PAYMENT_PROVIDERS: "mock,manual",
            EMAIL_PROVIDER: "console",
            LOG_LEVEL: "silent",
            WORKER_IN_PROCESS: "false",
            NODE_ENV: "test",
          },
        },
      },
    ],
  },
});
