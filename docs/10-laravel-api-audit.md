# 10 · Laravel API: audit of the existing backend and implementation plan

Audit date 2026-10-07 (commit `fb9b081` + uncommitted step-3 models). Source of truth for behaviour:
`src/features/*/service.ts`, `src/services/**`, `src/lib/**`, `src/app/api/**`. Database: the 42
Prisma tables (`prisma/schema.prisma`), adopted unchanged by `backend/`.

## A. Current API endpoint inventory (Next.js route handlers)

| Method | Path | Auth | Permission / scope | Behaviour |
|---|---|---|---|---|
| GET | `/api/health` | none | – | `SELECT 1`, count of stuck queued messages |
| POST/GET | `/api/internal/worker/tick` | `Bearer CRON_SECRET` | – | one worker cycle + housekeeping |
| POST | `/api/v1/auth/register` | none | rl 5/h/IP | user + org + roles + wallet (tx), verification + welcome email, starts session |
| POST | `/api/v1/auth/login` | none | rl 20/10min/IP + 10/10min/account | argon2id, lockout 5 fails → 15 min, sets cookie |
| POST | `/api/v1/auth/logout` | session | – | deletes session row |
| POST | `/api/v1/auth/email/verify` | none | rl 5/h | consumes EMAIL_VERIFY token |
| POST | `/api/v1/auth/password/forgot` | none | rl 5/h/IP | always 202 (no enumeration), 1 h token |
| POST | `/api/v1/auth/password/reset` | none | rl 5/h | consumes token, revokes all sessions |
| POST | `/api/v1/sms/send` | API key | `sms:send`, 120/min, Idempotency-Key | single SMS, 202 `{message_id,…}` |
| POST | `/api/v1/sms/bulk` | API key | `sms:send`, 120/min, Idempotency-Key | ≤1,000 recipients, per-recipient message/variables |
| POST | `/api/v1/sms/estimate` | API key | `sms:send` | segments + cost, nothing charged |
| GET | `/api/v1/messages` | API key | `messages:read` | keyset cursor pagination |
| GET | `/api/v1/messages/{id}` | API key | `messages:read` | status + events |
| GET | `/api/v1/balance` | API key | `balance:read` | balance + plan rates |
| GET | `/api/v1/sender-ids` | API key | `sender_ids:read` | sender IDs with status |
| GET | `/api/v1/app/contacts/export` | session | `contacts:export` | CSV |
| GET | `/api/v1/app/campaigns/{id}/export` | session | `reports:export` | CSV |
| GET | `/api/v1/app/reports/export` | session | `reports:export` | CSV |
| GET | `/api/v1/app/transactions/export` | session | `billing:read` | CSV |
| GET | `/api/v1/app/sender-ids/{id}/documents/{i}` | session | `sender_ids:read` | tenant-scoped download |
| GET | `/api/v1/admin/customers` | admin | `admin:customers:read` | organizations list |
| POST | `/api/v1/admin/customers/{id}/status` | admin | `admin:customers:manage` | suspend / activate |
| POST | `/api/v1/admin/payments/{id}/review` | admin | `admin:billing:manage` | approve (credit) / reject manual payment |
| POST | `/api/v1/admin/sender-ids/{id}/review` | admin | `admin:sender_ids:review` | approve (fee debit) / reject / suspend |
| GET | `/api/v1/admin/sender-ids/{id}/documents/{i}` | admin | `admin:sender_ids:review` | audited download |
| GET | `/api/v1/admin/stats` | admin | `admin:access` | platform metrics |
| GET/POST | `/api/v1/payments/{provider}/return` | none | – | browser return; verified with gateway; 303 redirect |
| POST | `/api/v1/webhooks/payments/{provider}` | none (gateway re-validation) | 1,200/min/IP | IPN, idempotent |
| POST | `/api/v1/webhooks/sms/{provider}` | provider signature | 1,200/min/IP | delivery reports, idempotent |
| POST | `/api/v1/webhooks/sms/{provider}/inbound` | provider signature | 1,200/min/IP | STOP opt-outs |

Plus **78 server actions** (the real dashboard/admin write API): auth 12, admin 20, team 7, contacts 8,
settings 6, wallet 6, campaigns 5, developers 4, sender IDs 3, support 3, templates 2, public forms 2,
and ~43 pages that read through `features/*/service.ts`. Every one of them is listed with its Laravel
replacement in [11-laravel-api-reference.md](11-laravel-api-reference.md) (migration matrix).

Common contract (`src/lib/api/handler.ts`, `response.ts`, `errors.ts`): envelope
`{success,data,meta:{requestId}}` / `{success:false,error:{code,message,details?},meta}`;
`X-Request-Id`; `Cache-Control: no-store`; validation details are
`{"fields":[{"path","message"}]}`; error codes from `src/lib/errors.ts`; API-key requests logged to
`api_logs`; `Idempotency-Key` (24 h, request-hash conflict → `IDEMPOTENCY_CONFLICT`).

## B. Prisma / database operation inventory (by area)

| Area | Operations that matter for correctness |
|---|---|
| Sessions | create (sha256 token), resolve (+ expiry, user status, `passwordChangedAt` invalidation, touch every 5 min), delete |
| Rate limits | `INSERT … ON DUPLICATE KEY UPDATE count=count+1` on `rate_limit_buckets` (fixed window), fail-open |
| Wallet | `UPDATE wallets SET balance=balance-x WHERE organizationId=? AND balance>=x` (never negative) + ledger row; credit resets low-balance flag; ledger unique `(reason, referenceType, referenceId)` |
| Send | `SELECT … FROM wallets FOR UPDATE` → daily/monthly counts → debit → `createMany(messages)`, one transaction |
| Dispatch | non-locking candidate read → `SELECT … WHERE id IN (…) ORDER BY id FOR UPDATE` → lease `lockedUntil`, `attempts+1` (MariaDB 10.4-safe, no `SKIP LOCKED`) |
| Status | `SELECT … FOR UPDATE` on message → `INSERT IGNORE message_events(dedupeKey)` → forward-only transition → refund → campaign counters → outbound webhook rows |
| Campaign launch | conditional claim `SCHEDULED→PROCESSING`, audience resolution, single debit, chunked inserts (5,000) |
| Payments | conditional `PENDING/AWAITING→SUCCEEDED`, credit, gap-free invoice number (`UPDATE counters SET value=value+1` in tx) |
| Contacts | upsert by `(organizationId, phone)`, soft delete, JSON tag append (`JSON_ARRAY_APPEND`), chunked import (2,000) |
| Reports | `GROUP BY status`, Dhaka-day bucketing `DATE_FORMAT(DATE_ADD(col, INTERVAL 360 MINUTE))` |

## C. The 42 Eloquent models

AbuseReport, ApiKey, ApiLog, AuditLog, BlocklistEntry, Campaign, CampaignRecipient, Contact,
ContactGroup, ContactGroupMember, ContactRequest, Counter, CreditPackage, IdempotencyKey,
InboundWebhookEvent, Invitation, Invoice, Message, MessageEvent, Notification,
NotificationPreference, Organization, OrganizationMember, Payment, Permission, PricingPlan,
RateLimitBucket, Role, RolePermission, SenderId, Session, Setting, SupportMessage, SupportTicket,
SuppressionEntry, Template, User, VerificationToken, Wallet, WalletTransaction, WebhookDelivery,
WebhookEndpoint (+ abstract `BaseModel`). Strict mode outside production (no lazy loading, no
silently discarded attributes); privileged columns are not fillable.

## D. Authentication today

- Passwords: argon2id (m=19456, t=2, p=1) — `password_verify()` compatible (verified by test).
- Sessions: random 32-byte base64url token in the httpOnly cookie `__Host-sf_session`; DB stores only
  `sha256(token)`; 7 days (30 with remember-me); active organization on the session row.
- Lockout: 5 failures → 15 min; per-IP and per-account DB rate limits; timing equalisation for unknown accounts.
- Email verification (24 h) / password reset (1 h) tokens: sha256 in `verification_tokens`; phone OTP = HMAC(AUTH_SECRET, `id:code`).
- **No Sanctum, no JWT.** → Laravel adopts the same tokens (decision below), so existing users and
  existing sessions keep working when the frontend switches.

## E. Authorization / roles

- Platform roles `USER / SUPPORT / ADMIN / SUPER_ADMIN` with a fixed permission matrix (`admin:*`, 14 permissions).
- Per-organization roles `OWNER / ADMIN / MANAGER / DEVELOPER / VIEWER`, permissions stored in
  `role_permissions` (editable per organization, 22 permissions).
- Tenant isolation: every query is scoped by `organizationId`; cross-tenant ids behave as 404.
- API keys act only through scopes (`sms:send`, `messages:read`, `balance:read`, `sender_ids:read`).

## F. SMS architecture

Provider interface (`mock`, generic `http`, admin-configurable with encrypted credentials);
GSM-7/UCS-2 segmentation with configurable limits; BD numbers normalised to `+8801[3-9]XXXXXXXX`
(the platform is **BD-only**: international numbers are rejected, by design); compliance: platform
blocklist (numbers/keywords/domains), org suppression list (promotional), quiet hours (promotional,
21:00–09:00 Dhaka), daily/monthly caps, sender ID approval, risk review. Messages table is the send
queue (lease-based claiming), retries with exponential backoff (4 attempts), delivery via webhook and
polling (72 h expiry, no refund), refund on failure per policy, outbound customer webhooks (signed,
8 attempts), STOP handling.

## G. Wallet / payment architecture

Prepaid BDT wallet, `DECIMAL(14,4)`, CHECK `balance >= 0`; reserve-on-send, refund on failure; low
balance alert once per crossing. Payments: `mock` (dev/staging only), `manual` (bank/bKash reference →
admin verification), `sslcommerz` (redirect + IPN; result always re-validated with the gateway;
failure callbacks never change state). VAT on top of subtotal; package bonus credited; gap-free
invoice numbers `INV-YYYY-00NNNN`; pending online payments expire after 48 h.

## H. Campaign architecture

DRAFT → (submit) → PENDING_REVIEW | SCHEDULED → PROCESSING → COMPLETED; PAUSED / CANCELLED / FAILED.
Review required when the org flag is set and the send is promotional or > 50 recipients, when risk
heuristics fire, or when > 5,000 recipients. Launch charges the whole campaign once, then queues
messages; finalisation when no queued messages remain; cancellation cancels + refunds queued messages.

## I. Admin functionality

Overview metrics; customers (controls, limits, plan, status, wallet adjust); users (platform role,
status, super-admin floor); campaign review; sender ID review (+ fee); manual payment review;
support desk (internal notes, assignment, status); pricing plans/packages; billing policy; SMS policy;
SMS provider + payment settings (secrets encrypted, never returned); site content; blocklist; abuse
reports; leads (contact requests); audit/API/message logs.

## J. Webhooks

Inbound: SMS delivery (`/webhooks/sms/{provider}`), inbound SMS (`…/inbound`), payment IPN — all
deduplicated via `inbound_webhook_events.eventKey` (unique) and the forward-only status machine.
Outbound: `webhook_deliveries` queue, HMAC-SHA256 signature `t=…,v1=…`, SSRF re-check before each
delivery.

## K. Cron / workers

`scripts/worker.ts` (loop) or `POST /api/internal/worker/tick` every minute: launch due campaigns →
dispatch batches (time budget) → cancel leftovers of cancelled campaigns → poll delivery → finalise
campaigns → deliver webhooks; housekeeping every 10 min (expire payments, purge sessions, rate
limits, idempotency keys, old tokens).

## L–R. Missing in Laravel (before this work)

Everything except health, envelope, exception rendering, CORS and models: no controllers, services,
form requests, policies/gates, resources, jobs, commands, middleware, scheduler, mail. Implemented in
this phase — see [11-laravel-api-reference.md](11-laravel-api-reference.md) for the final lists.

Events/listeners: the Node app has none (side effects are explicit service calls inside or right
after transactions). The port keeps explicit calls; queued **jobs** carry the asynchronous work.

## S. Security risks found / to keep closed

| Risk | Status in Node | Laravel handling |
|---|---|---|
| IDOR | scoped queries | every service lookup is `(id, organizationId)`; tests for cross-tenant 404 |
| Mass assignment | Prisma explicit data | fillable lists + `forceFill` only in services; FormRequest `validated()` only |
| Double charge / overspend | conditional UPDATE + row lock | same SQL, same transaction order |
| Webhook spoofing | adapter signature check | same (HMAC, constant-time), unsigned rejected in production |
| SSRF (customer webhooks) | HTTPS-only, private-IP block, DNS re-check | ported |
| CSV injection | quote-prefix on export | ported |
| File uploads | size, MIME, extension, magic bytes, random key | ported (+ Laravel `File` rules) |
| Secrets in logs | pino redaction | Laravel log context never includes bodies/keys; phones masked |
| Debug leakage | generic 500 | already: exception renderer hides internals even with `APP_DEBUG=true` |

## T. Database risks

- Shared database during the transition: both backends may run; only **one** scheduler/worker at a
  time is recommended (claims are atomic so overlap is safe, just wasteful).
- MariaDB 10.4 on Hostinger (also local): no `SKIP LOCKED`, no `JSON_TABLE`, no `RETURNING` → not used.
- `updatedAt` has no DB default → every raw insert sets it explicitly.
- No schema changes were needed: all query patterns are covered by the existing indexes.

## U. Implementation order (as executed)

1. Foundation: crypto/money/phone/segments/time helpers, settings, rate limiter, audit, request id/logging.
2. Auth: session-token guard on the existing `sessions` table, auth endpoints, tenant context, gates.
3. Contacts / groups / suppression / import (queued) / export.
4. Templates, sender IDs (+ documents).
5. Wallet / transactions / pricing.
6. SMS core: providers, segmentation, compliance, send, delivery, dispatcher.
7. Campaigns + jobs + scheduler.
8. Delivery / inbound / payment webhooks; outbound webhooks.
9. Payments (mock/manual/SSLCommerz), invoices.
10. Reports, dashboard, message history.
11. Developers (API keys, webhooks, logs), team, settings/profile, notifications, support.
12. Admin API.
13. Public customer API (API-key auth, idempotency, API logs).
14. Tests, security review, docs, deployment.

## Decisions taken where the request and the existing app differ

1. **Validation error shape**: the request shows `details: {"field": ["msg"]}`; the existing public
   API (customer contract, and the existing Laravel test) uses `details: {"fields":[{"path","message"}]}`.
   Kept the existing shape — changing it would break API customers.
2. **Dashboard route prefix**: `/api/v1/messages` and `/api/v1/sender-ids` already exist as API-key
   customer endpoints with a fixed snake_case contract. The existing app already uses
   `/api/v1/app/*` for session (dashboard) endpoints, so the dashboard API lives under
   `/api/v1/app/*` (`/api/v1/app/contacts`, `/api/v1/app/campaigns`, …). This keeps customer API
   and dashboard API authentication fully separate.
3. **Auth**: no Sanctum. A Laravel guard reads the existing `sessions` table (sha256 of the same
   token). The Next.js server sends its existing cookie value as `Authorization: Bearer <token>` →
   nobody is logged out at cutover, and there is exactly one session system.
4. **International numbers**: the existing app accepts only Bangladesh mobile numbers. Kept.
5. **Queue design**: the `messages` table stays the SMS queue (lease claiming, retry state on the
   row); Laravel jobs and the scheduler drive it. This keeps idempotency on the data, works on
   shared hosting (`database` queue + `schedule:run`), and is compatible with the Node worker during
   the transition.
