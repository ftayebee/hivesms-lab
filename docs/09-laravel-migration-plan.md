# 09 · Backend migration: Next.js + Prisma → Next.js + Laravel API (MySQL)

Status: **audit complete, migration not started on the backend.** Audit date 2026-10-06, commit `b01ea87`.

## 1. Current architecture

One Next.js 16 app (App Router, ~25k lines of TS in `src/`) is frontend **and** backend:

```
Browser ──► Next.js server components / server actions / route handlers ──► Prisma 7 (mariadb adapter) ──► MySQL
                                   ▲
Cron (every minute) ──► POST /api/internal/worker/tick  (campaign launch, dispatch, delivery polling, webhooks)
```

- 70 pages; **43 pages/layouts read the database directly** (via `features/*/service.ts`).
- 78 server actions in 12 `features/*/actions.ts` files do all dashboard/admin writes.
- 30 route handlers: public SMS API, auth API, admin API, CSV exports, webhooks, worker tick.
- No client component touches the database (verified); all DB access is server-side.

## 2–3. Data model (Prisma models = MySQL tables)

42 models / tables, 29 enums, 49 foreign keys (35 cascade, 9 set-null, 5 restrict), 30 unique
constraints. UUID primary keys stored as `CHAR(36)`; **camelCase column names** (`organizationId`,
`createdAt`, `updatedAt`, `deletedAt`); money is `DECIMAL(14,4)`; string lists are JSON arrays;
`utf8mb4_unicode_ci` with `utf8mb4_bin` on external identifiers; CHECK constraints on wallet balance
and ledger amounts; invoice numbers from a `counters` row.

| Area | Tables |
|---|---|
| Identity | `users`, `sessions`, `verification_tokens` |
| Tenancy / RBAC | `organizations`, `organization_members`, `invitations`, `roles`, `permissions`, `role_permissions` |
| Audience | `contacts`, `contact_groups`, `contact_group_members`, `suppression_entries` |
| Messaging | `sender_ids`, `templates`, `campaigns`, `campaign_recipients`, `messages`, `message_events`, `inbound_webhook_events` |
| Developer | `api_keys`, `api_logs`, `idempotency_keys`, `webhooks`, `webhook_deliveries` |
| Billing | `pricing_plans`, `credit_packages`, `wallets`, `wallet_transactions`, `payments`, `invoices`, `counters` |
| Support / ops | `support_tickets`, `support_messages`, `notifications`, `notification_preferences`, `audit_logs`, `settings`, `blocklist_entries`, `abuse_reports`, `contact_requests`, `rate_limit_buckets` |

Tenancy is **per organization** (not per user): every customer row carries `organizationId`;
users join organizations through `organization_members` with a role.

## 4. Authentication today

- Passwords: **argon2id** (`@node-rs/argon2`, m=19456, t=2, p=1). PHP's `password_verify` reads these hashes (verified: `PASSWORD_ARGON2ID` available) → **no password resets needed**.
- Sessions: random 32-byte token in an httpOnly cookie (`__Host-sf_session`); only `sha256(token)` stored in `sessions`; 7 days, 30 with "remember me"; revocable; active organization stored on the session.
- Email verification and password reset via `verification_tokens` (hashed); phone OTP (HMAC with `AUTH_SECRET`); account lockout after 5 failures; per-IP/per-account DB-backed rate limits.
- Authorization: platform roles `USER/SUPPORT/ADMIN/SUPER_ADMIN` (admin area) + per-organization roles `OWNER/ADMIN/MANAGER/DEVELOPER/VIEWER` with a permission catalogue.
- Customer API keys: `sfk_live_<id>_<secret>`, stored as **HMAC-SHA256(API_KEY_PEPPER, key)**, scopes, IP allowlist.

## 5–6. Endpoints and server actions

Route handlers (`src/app/api`): `auth/{login,logout,register,email/verify,password/forgot,password/reset}`,
`sms/{send,bulk,estimate}`, `messages`, `messages/{id}`, `balance`, `sender-ids`,
`app/*/export` (CSV), `admin/{customers,customers/{id}/status,payments/{id}/review,sender-ids/{id}/review,sender-ids/{id}/documents/{i},stats}`,
`payments/{provider}/return`, `webhooks/payments/{provider}`, `webhooks/sms/{provider}`, `webhooks/sms/{provider}/inbound`, `internal/worker/tick`, `health`.

Server actions (78): auth 12, admin 20, team 7, contacts 8, settings 6, wallet 6, campaigns 5,
developers 4, sender-ids 3, support 3, templates 2, public forms 2.

## 7. SMS

Provider abstraction already exists (`services/sms`: `mock`, generic `http`). GSM-7/UCS-2 segment
calculation (`lib/sms-segments.ts`), BD number normalisation/operator detection (`lib/phone.ts`),
compliance (blocklist, suppression, quiet hours, daily/monthly caps, sender ID approval),
queue in the `messages` table claimed with `SELECT … FOR UPDATE SKIP LOCKED` + lease,
retries with backoff, delivery reports (webhook + polling), idempotent status events
(`message_events.dedupeKey`), inbound STOP handling, signed outbound customer webhooks.

## 8. Wallet / payments

Ledger in `wallet_transactions`; balance updated with row locks inside transactions, CHECK ≥ 0;
reserve-on-send / refund-on-failure; low-balance alerts; providers `mock`, `manual` (bank/bKash
reference + admin review), `sslcommerz` (redirect + IPN, validated server-side); invoices numbered
gap-free from `counters`.

## 9. Admin

Customers/organizations (status, limits, wallet adjustments), users and platform roles, campaign
review, sender ID review with documents, payment review, pricing plans/packages, settings
(SMS/payment providers, encrypted with AES-256-GCM + `SETTINGS_ENCRYPTION_KEY`), support desk,
abuse reports, blocklist, audit/API/message logs.

## 10. Coupling

Tight: pages and actions call service functions that call Prisma directly. The UI layer
(components, forms, `ActionResult` shape) is cleanly separated from those services, which is what
makes an incremental swap possible.

## 11–12. What changes / what stays

**Changes:** `src/lib/db.ts`, `db-errors.ts`, `sql.ts`, `rate-limit.ts`, `audit.ts`,
`auth/session*.ts`, `api/*`, `tenant-action.ts`, all `features/*/service.ts`, `features/*/actions.ts`
(bodies only, signatures kept), `features/reports/*`, `features/admin/{service,overview}.ts`,
`services/**` (moves to Laravel), all `src/app/api/**` (moves to Laravel; Next keeps thin proxies only
where the browser needs same-origin downloads), `prisma/`, `prisma.config.ts`, `scripts/*.ts`, tests.

**Stays:** all of `src/components/**` (except removing the theme toggle), page markup, forms,
`lib/{format,money,phone,sms-segments,utils,seo,safe-url}.ts` (pure client-safe helpers, also
ported to PHP), i18n, marketing pages, docs content, Tailwind design system (light theme only).

## 13. Risks

| Risk | Mitigation |
|---|---|
| Laravel's default migrations create `users`, `sessions`, `password_reset_tokens`, which **already exist with a different shape** | Do not ship Laravel's default `users/sessions` migrations; adopt existing tables via a schema baseline (below). Laravel-own tables (`jobs`, `failed_jobs`, `job_batches`, `cache`, `cache_locks`) don't collide. |
| Existing passwords, sessions, API keys, encrypted settings must keep working | Port the exact algorithms: argon2id verify, sha256 session tokens, HMAC-SHA256 API keys with the same pepper, AES-256-GCM settings with the same key. Covered by compatibility tests against values produced by the Node code. |
| Two backends writing one database during the transition | Feature-by-feature cutover on the shared schema; only one side runs background work at a time (switch the cron from the Node tick to `schedule:run` in one step). |
| Public SMS API is a customer contract | Same paths, auth header, request fields, response envelope `{success,data,meta}` / `{success:false,error:{code,message,details},meta}` and error codes. Contract tests run against both implementations. |
| camelCase columns | Eloquent maps them directly (`const CREATED_AT = 'createdAt'`, etc.); no renames. |
| Money precision | `decimal:4` casts + `bcmath` (or brick/math); never floats. |
| Hosting | Hostinger shared/Business: PHP + cron, **no** long-running workers or Redis (to be confirmed on the account). Use the `database` queue driver, `schedule:run` every minute, and a scheduled `queue:work --stop-when-empty`. Redis + Supervisor only on a VPS. |
| Local PHP is 8.2 (XAMPP) | Laravel 13 (current, needs PHP ≥ 8.3) is recommended; Laravel 12 runs on 8.2 but its security support ends Feb 2027. |

## 14. Target architecture

```
backend/   Laravel 13 API (api.<domain>)
  app/Http/Controllers/Api/V1/…     thin controllers
  app/Http/Requests/…               Form Requests (validation, BD phone rule)
  app/Http/Resources/…              API Resources (envelope above)
  app/Models/…                      42 Eloquent models on the existing tables
  app/Policies/…                    organization-scoped policies + platform-role gates
  app/Services/{Auth,Billing,Messaging,Sms,Payments,…}
  app/Services/Sms/{SmsProviderInterface,SmsProviderManager,Providers/*}
  app/Jobs/{LaunchCampaign,DispatchMessages,PollDelivery,DeliverWebhook,ImportContacts,…}
  app/Auth/SessionTokenGuard.php    reads the existing `sessions` table (Bearer token)
  app/Auth/ApiKeyGuard.php          customer API keys
  routes/api.php                    /api/v1/…
  database/schema/mysql-schema.sql  baseline of the 42 existing tables
frontend/  (= current repo root for now) Next.js UI
  src/lib/api/laravel.ts            server-only client: base URL, Bearer from cookie, envelope → ActionResult
```

Next.js keeps server components and server actions as a thin BFF: they forward the session cookie
as a Bearer token to Laravel server-to-server. The browser never needs the API token and pages keep
their current structure. `API_URL` (server-side) points at Laravel; `NEXT_PUBLIC_API_URL` only if
client-side calls are added.

Moving the Next.js app into `frontend/` is deferred to the end (pure file move, separate commit),
to keep every intermediate step buildable and deployable.

## 15. Migration order (each step ships and is verified before the next)

| # | Step | Verification |
|---|---|---|
| 1 | Light mode only (remove dark theme) | lint, typecheck, build, visual check |
| 2 | Scaffold `backend/` (Laravel 13), DB config, CORS, envelope/exception handler, health endpoint, schema baseline for existing tables | `route:list`, `migrate:status` on a copy of the DB, `php artisan test` |
| 3 | Eloquent models + relationships + enums for all 42 tables, factories | model tests on a test DB |
| 4 | Compatibility layer: argon2id, session-token guard, API-key guard, AES-GCM settings, rate limiter, audit log | tests with fixtures produced by the Node code |
| 5 | Auth API (register/login/logout/me/verify/reset/OTP/org switch) → switch Next auth actions to Laravel | Laravel feature tests; E2E sign-up/sign-in |
| 6 | Read side: dashboard, reports, lists → pages fetch from Laravel | page-by-page parity checks |
| 7 | Contacts/groups/suppression/import (queued), templates, sender IDs (+documents), team, settings, support | feature tests per module |
| 8 | Wallet, payments (mock/manual/SSLCommerz), invoices — transactional + locked | concurrency tests |
| 9 | Messaging core: send/estimate/bulk, campaigns, dispatch jobs, delivery webhooks/polling, inbound, outbound webhooks, scheduler; switch cron | queue/job tests, idempotency tests |
| 10 | Public SMS API on Laravel (same contract), API logs, idempotency keys | contract tests vs. current responses |
| 11 | Admin API + admin pages | authorization tests (non-admin → 403) |
| 12 | Remove Prisma (deps, `prisma/`, config, `DATABASE_URL` from Next), move UI to `frontend/`, docs, deployment | repo-wide search, `npm ls`, both builds |

Estimated scale: the backend port is ~15–20k lines of PHP. It will take many working sessions; each
step above is a self-contained, reviewable commit.
