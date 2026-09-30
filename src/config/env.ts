import path from "node:path";
import { z } from "zod";

/**
 * Server-side environment, validated once on first access.
 * Never import this module from client components: these values are secrets.
 */
const bool = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url().default("http://localhost:3000"),
  DEFAULT_LOCALE: z.enum(["en", "bn"]).default("en"),
  DATABASE_URL: z.string().min(1),

  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  API_KEY_PEPPER: z.string().min(32, "API_KEY_PEPPER must be at least 32 characters"),
  SETTINGS_ENCRYPTION_KEY: z.string().min(32),
  CRON_SECRET: z.string().min(16),

  SMS_PROVIDER: z.enum(["mock", "http"]).default("mock"),
  SMS_PROVIDER_URL: z.string().optional().default(""),
  SMS_PROVIDER_API_KEY: z.string().optional().default(""),
  SMS_PROVIDER_API_SECRET: z.string().optional().default(""),
  SMS_PROVIDER_WEBHOOK_SECRET: z.string().optional().default(""),
  SMS_DEFAULT_SENDER_ID: z.string().optional().default("8809600000000"),

  PAYMENT_PROVIDERS: z.string().default("mock,manual"),
  PAYMENT_PROVIDER_KEY: z.string().optional().default(""),
  PAYMENT_PROVIDER_SECRET: z.string().optional().default(""),
  PAYMENT_PROVIDER_LIVE: bool,
  /** Enables the mock checkout in production builds. Only for staging and E2E runs; never on a live site. */
  ALLOW_MOCK_PAYMENTS: bool,

  EMAIL_PROVIDER: z.enum(["console", "http"]).default("console"),
  EMAIL_PROVIDER_URL: z.string().optional().default(""),
  EMAIL_PROVIDER_KEY: z.string().optional().default(""),
  EMAIL_FROM: z.string().default("SMSFlow BD <no-reply@example.com>"),

  STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
  STORAGE_S3_ENDPOINT: z.string().optional().default(""),
  STORAGE_S3_REGION: z.string().optional().default(""),
  STORAGE_S3_BUCKET: z.string().optional().default(""),
  STORAGE_S3_ACCESS_KEY_ID: z.string().optional().default(""),
  STORAGE_S3_SECRET_ACCESS_KEY: z.string().optional().default(""),

  FEATURE_PHONE_VERIFICATION: bool,
  FEATURE_REGISTRATION_OPEN: z
    .enum(["true", "false", "1", "0", ""])
    .optional()
    .transform((v) => v === undefined || v === "" || v === "true" || v === "1"),

  /** Where the local storage driver and dev mailbox write. Use an absolute path (a volume) in containers. */
  LOCAL_DATA_DIR: z.string().default(".local"),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}\nSee .env.example.`);
  }
  cached = parsed.data;
  return cached;
}

export const isProduction = () => process.env.NODE_ENV === "production";

/** Absolute path inside LOCAL_DATA_DIR. The standalone server changes its working directory, so relative defaults are resolved once here. */
export function localDataPath(...parts: string[]) {
  return path.resolve(process.env.LOCAL_DATA_DIR || ".local", ...parts);
}
