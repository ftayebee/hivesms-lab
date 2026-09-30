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
            SMS_PROVIDER: "mock",
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
