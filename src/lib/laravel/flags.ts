import "server-only";

/**
 * Per-feature cutover switches from Prisma to the Laravel API (docs/14-frontend-laravel-cutover-audit.md).
 *
 * LARAVEL_FEATURES (server only) is a comma-separated list of the features below, or `all`.
 * Unset or empty → every feature keeps its Prisma implementation, so removing a name from the
 * list (and restarting) is the rollback for that feature. At runtime each feature has exactly one
 * backend path: either Laravel or Prisma, never both.
 *
 *   LARAVEL_FEATURES=auth,profile,dashboard
 *   LARAVEL_FEATURES=all
 *   LARAVEL_FEATURES=all,-payments      # everything except payments
 */
export const LARAVEL_FEATURES = [
  "auth", // login, register, logout, session/me, password reset, email/phone verification, org switch, onboarding, invitations
  "profile", // settings page: profile, organization, password, sessions, notification preferences, locale
  "dashboard", // dashboard home aggregates
  "contacts", // contacts, groups, suppression, import, export
  "templates",
  "senderIds", // sender IDs incl. document upload/download
  "campaigns", // campaigns + composer (draft, estimate, submit, controls, export)
  "reports", // reports page, message log, report export
  "wallet", // wallet, transactions, invoices, threshold, transaction export
  "payments", // top-ups / checkout / manual reference / cancel
  "developers", // API keys, API logs, webhooks
  "team",
  "notifications",
  "support",
  "admin",
  "public", // marketing pricing, site content, contact + abuse forms
  "publicApi", // customer REST API hosted on this domain (/api/v1/sms/*, messages, balance, sender-ids): proxied to Laravel
  "webhooks", // provider delivery/inbound webhooks, payment IPN and payment return on this domain: proxied to Laravel
  "worker", // background sending/delivery polling: Laravel scheduler (sms:work); the Node worker and tick stand down
] as const;

export type LaravelFeature = (typeof LARAVEL_FEATURES)[number];

let cached: { raw: string; set: ReadonlySet<LaravelFeature> } | undefined;

function parse(raw: string): ReadonlySet<LaravelFeature> {
  const known = new Set<string>(LARAVEL_FEATURES);
  const out = new Set<LaravelFeature>();
  for (const part of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (part === "all") LARAVEL_FEATURES.forEach((f) => out.add(f));
    else if (part.startsWith("-") && known.has(part.slice(1))) out.delete(part.slice(1) as LaravelFeature);
    else if (known.has(part)) out.add(part as LaravelFeature);
  }
  return out;
}

export function enabledLaravelFeatures(): ReadonlySet<LaravelFeature> {
  const raw = process.env.LARAVEL_FEATURES ?? "";
  if (cached?.raw !== raw) cached = { raw, set: parse(raw) };
  return cached.set;
}

/** True when this feature reads and writes through the Laravel API instead of Prisma. */
export function laravelEnabled(feature: LaravelFeature): boolean {
  return enabledLaravelFeatures().has(feature);
}
