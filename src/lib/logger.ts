import pino from "pino";

/**
 * Structured JSON logger. Pipe through `pino-pretty` locally for readable output.
 * Redaction removes secrets even if a caller accidentally logs them.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "smsflow" },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "password",
      "*.password",
      "passwordHash",
      "*.passwordHash",
      "token",
      "*.token",
      "apiKey",
      "*.apiKey",
      "secret",
      "*.secret",
      "authorization",
      "*.authorization",
      "headers.authorization",
      "headers.cookie",
      "*.headers.authorization",
      "*.headers.cookie",
      "cookie",
      "*.api_secret",
      "*.store_passwd",
      "*.cardNumber",
    ],
    censor: "[REDACTED]",
  },
});

export type Logger = typeof logger;

/** Masks a phone number for logs: +8801712345678 -> +880171****678 */
export function maskPhone(phone: string): string {
  if (phone.length < 8) return "****";
  return `${phone.slice(0, 7)}****${phone.slice(-3)}`;
}

/** Masks an email for logs: rahim@example.com -> ra***@example.com */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return "***";
  return `${user.slice(0, 2)}***@${domain}`;
}
