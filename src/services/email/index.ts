import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { logger, maskEmail } from "@/lib/logger";
import { localDataPath } from "@/config/env";

/**
 * Email provider abstraction.
 *  - console: development adapter. Writes each email as an .html file into .local/mailbox and
 *    logs the subject, so verification and reset links can be opened locally. Sends nothing.
 *  - http: generic JSON email API adapter (UNVERIFIED; map it to your provider, see
 *    docs/05-integrations.md). Posts { from, to, subject, html, text } with a Bearer key.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  tag?: string;
}

export interface EmailProvider {
  readonly key: string;
  send(message: EmailMessage): Promise<{ ok: boolean; id?: string; error?: string }>;
}

class ConsoleEmailProvider implements EmailProvider {
  readonly key = "console";
  async send(message: EmailMessage) {
    const dir = localDataPath("mailbox");
    const safeTag = (message.tag ?? "email").replace(/[^a-z0-9-]/gi, "_");
    const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}_${safeTag}.html`);
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(file, `<!-- To: ${message.to} | Subject: ${message.subject} -->\n${message.html}`, "utf8");
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "could not write dev mailbox file");
    }
    logger.info({ to: maskEmail(message.to), subject: message.subject, file }, "[dev email] written to local mailbox");
    if (process.env.NODE_ENV !== "production") {
      // Plain-text version in the dev console makes links easy to click.
      console.log(`\n── DEV EMAIL to ${message.to}: ${message.subject}\n${message.text}\n`);
    }
    return { ok: true, id: path.basename(file) };
  }
}

class HttpEmailProvider implements EmailProvider {
  readonly key = "http";
  constructor(
    private url: string,
    private apiKey: string,
    private from: string,
  ) {}
  async send(message: EmailMessage) {
    if (!this.url || !this.apiKey) return { ok: false, error: "Email provider not configured" };
    try {
      const res = await fetch(this.url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ from: this.from, to: message.to, subject: message.subject, html: message.html, text: message.text }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const body = (await res.json().catch(() => ({}))) as { id?: string };
      return { ok: true, id: body.id };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
}

let provider: EmailProvider | undefined;

export function getEmailProvider(): EmailProvider {
  if (provider) return provider;
  provider =
    process.env.EMAIL_PROVIDER === "http"
      ? new HttpEmailProvider(process.env.EMAIL_PROVIDER_URL ?? "", process.env.EMAIL_PROVIDER_KEY ?? "", process.env.EMAIL_FROM ?? "")
      : new ConsoleEmailProvider();
  return provider;
}

/** Sends an email without throwing: failures are logged, never block the user flow. */
export async function sendEmail(message: EmailMessage) {
  try {
    const result = await getEmailProvider().send(message);
    if (!result.ok) logger.error({ to: maskEmail(message.to), tag: message.tag, error: result.error }, "email send failed");
    return result;
  } catch (err) {
    logger.error({ err, tag: message.tag }, "email provider threw");
    return { ok: false, error: (err as Error).message };
  }
}
