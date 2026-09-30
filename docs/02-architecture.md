# Phase 2: Architecture

## 1. System overview

```
                          ┌──────────────────────────────────────────────────────────┐
 Browser (marketing,      │                 Next.js 16 app (Node runtime)            │
 dashboard, admin, docs)  │                                                          │
  ───── HTTPS ──────────► │  proxy.ts  (security headers, auth redirect gate)        │
                          │     │                                                    │
                          │     ├─ App Router pages (RSC)  ── Server Actions ──┐     │
                          │     │                                              │     │
 Customer servers         │     ├─ /api/v1/*  Route Handlers                   │     │
  ── Bearer API key ────► │     │    auth · customer API · admin · webhooks    │     │
                          │     │                                              ▼     │
 SMS provider             │     │         features/*  (domain services, RBAC,        │
  ── delivery webhooks ─► │     │                      tenant-scoped queries)        │
                          │     │                        │                           │
 Payment gateway          │     │         services/*  (infrastructure)               │
  ── callbacks / IPN ───► │     │          ├─ messaging pipeline (queue, pricing)    │
                          │     │          ├─ sms/      SmsProvider adapters ────────┼──► Upstream SMS provider
                          │     │          ├─ payments/ PaymentProvider adapters ────┼──► Payment gateway
                          │     │          ├─ email/    EmailProvider adapters ──────┼──► Email service
                          │     │          ├─ storage/  StorageProvider adapters ────┼──► S3-compatible storage
                          │     │          └─ billing, rate-limit, risk, audit       │
                          └─────┼────────────────────────┼───────────────────────────┘
                                │                        │
                                ▼                        ▼
                          ┌───────────┐          ┌─────────────────────────────┐
                          │ PostgreSQL│ ◄─────── │ Worker process (scripts/     │
                          │ (Prisma)  │          │ worker.ts): scheduled        │
                          └───────────┘          │ campaigns, send queue,       │
                                                 │ retries, outbound webhooks,  │
                                                 │ cleanup                      │
                                                 └─────────────────────────────┘
```

**Why one Next.js app plus a worker?** The API, dashboard and marketing site share validation,
pricing, segmentation and authorization code. Splitting into a separate backend would duplicate
that logic without a clear benefit at this stage. Long-running work (campaign fan-out, retries,
webhook delivery) does not belong in a request, so it runs in a separate worker process that
imports the same services. The queue is PostgreSQL-backed (`FOR UPDATE SKIP LOCKED`), so no
Redis is required to start. The queue functions sit behind one module, so a dedicated broker can
replace them later.

## 2. Folder structure

```
.
├── docs/                         Product, architecture, design system, deployment, provider guides
├── prisma/
│   ├── schema.prisma             Relational schema (PostgreSQL)
│   ├── migrations/               SQL migrations (prisma migrate)
│   └── seed.ts                   Fictional demo data
├── prisma.config.ts
├── scripts/
│   ├── local-db.mjs              Embedded PostgreSQL for local development (no Docker needed)
│   └── worker.ts                 Background worker entry point
├── tests/
│   ├── unit/                     Vitest: segmentation, phone, pricing, permissions, adapters...
│   ├── integration/              Vitest against a real database: registration, send, webhooks...
│   └── e2e/                      Playwright: register, buy credits, campaign, API key...
├── Dockerfile · docker-compose.yml · .env.example
└── src/
    ├── app/
    │   ├── (marketing)/          Public site: home, products, pricing, solutions, legal...
    │   ├── (auth)/               Login, register, verify, password reset, invitations
    │   ├── docs/                 Developer documentation with sidebar
    │   ├── dashboard/            Customer app (tenant-scoped)
    │   ├── admin/                Platform admin panel
    │   ├── api/v1/               Versioned JSON API (auth, customer, admin, webhooks)
    │   ├── api/internal/         Worker tick + health (secret-protected)
    │   ├── sitemap.ts · robots.ts · layout.tsx · globals.css
    ├── components/
    │   ├── ui/                   Primitives (Button, Input, Dialog, DataTable, Tabs...)
    │   ├── marketing/            Navbar, Footer, hero, pricing cards, calculator...
    │   ├── dashboard/            Sidebar, DashboardHeader, StatsCard, charts, SmsComposer...
    │   ├── docs/                 DocumentationSidebar, ApiCodeBlock, EndpointCard
    │   └── shared/               EmptyState, ErrorState, LoadingState, ConfirmDialog, Logo
    ├── features/                 Domain modules: schemas.ts · service.ts · actions.ts · components/
    │   ├── auth/  contacts/  campaigns/  templates/  sender-ids/  reports/  wallet/
    │   ├── api-keys/  team/  support/  notifications/  webhooks/  settings/  admin/
    ├── services/                 Infrastructure behind interfaces
    │   ├── sms/                  SmsProvider interface, mock + HTTP adapters, registry
    │   ├── payments/             PaymentProvider interface, mock, manual, SSLCommerz adapters
    │   ├── email/                EmailProvider interface, console/file + HTTP adapters, templates
    │   ├── storage/              StorageProvider interface, local-disk + S3 adapters
    │   ├── messaging/            Send pipeline, queue, delivery events, compliance checks
    │   ├── billing/              Wallet ledger, invoices, VAT
    │   └── risk/                 Abuse heuristics hooks
    ├── lib/                      db, auth/session, rbac, api helpers, phone, sms-segments,
    │                             money, csv, rate-limit, logger, crypto, audit, format
    ├── config/                   site, env, features, pricing defaults, navigation
    ├── i18n/                     Dictionaries (en, bn) and helpers
    ├── hooks/                    Client hooks (copy-to-clipboard, debounce...)
    ├── types/
    └── generated/prisma/         Generated Prisma client (git-ignored)
```

Rule of thumb: **`services/`** wraps something external or cross-cutting (a provider, a queue,
the ledger). **`features/`** holds business rules for one domain and is the only layer that pages,
server actions and route handlers call.

## 3. Database schema

Full definition: [`prisma/schema.prisma`](../prisma/schema.prisma). All primary keys are UUIDs
(unguessable, safe to expose in URLs). Money is `Decimal(14,4)` in BDT. Every table has
`createdAt`; mutable tables have `updatedAt`; user-facing tenant data has `deletedAt` for soft
deletion.

| Group | Tables |
| --- | --- |
| Identity | `users`, `sessions`, `verification_tokens`, `invitations` |
| Tenancy and RBAC | `organizations`, `organization_members`, `roles`, `permissions`, `role_permissions` |
| Contacts | `contacts`, `contact_groups`, `contact_group_members`, `suppression_entries` |
| Messaging | `campaigns`, `campaign_recipients`, `messages`, `message_events`, `templates`, `sender_ids` |
| Developer | `api_keys`, `api_logs`, `idempotency_keys`, `webhooks` (customer endpoints), `webhook_deliveries`, `inbound_webhook_events` |
| Billing | `wallets`, `wallet_transactions`, `payments`, `invoices`, `pricing_plans`, `credit_packages` |
| Support | `support_tickets`, `support_messages` |
| Platform | `audit_logs`, `notifications`, `notification_preferences`, `settings`, `blocklist_entries`, `abuse_reports`, `contact_requests`, `rate_limit_buckets` |

Key constraints and indexes:

- `users.email` unique (stored lower-case); `users.phone` unique when present.
- `organization_members (organization_id, user_id)` unique.
- `contacts (organization_id, phone)` unique. Re-adding a soft-deleted contact restores it.
- `sender_ids (organization_id, value)` unique.
- `messages (provider, provider_message_id)` unique: webhook lookups and idempotency.
- `messages (organization_id, created_at)`, `(status, next_attempt_at)`, `(campaign_id, status)`.
- `message_events.dedupe_key` unique: replayed provider webhooks are no-ops.
- `wallet_transactions (reason, reference_type, reference_id)` unique: a refund or top-up can
  never be applied twice.
- `api_keys.key_hash` unique; `api_keys.prefix` unique (display and lookup).
- `idempotency_keys (organization_id, key)` unique.
- `payments (provider, provider_ref)` unique.

## 4. API architecture

All JSON endpoints live under `/api/v1` and return one envelope:

```json
{ "success": true, "data": {}, "meta": { "requestId": "req_..." } }
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "...", "details": {} }, "meta": { "requestId": "req_..." } }
```

| Surface | Prefix | Auth | Purpose |
| --- | --- | --- | --- |
| Auth | `/api/v1/auth/*` | none / session cookie | register, login, logout, verify, password reset |
| Customer (public API) | `/api/v1/sms`, `/messages`, `/balance`, `/sender-ids` | `Authorization: Bearer <api key>` with scopes | programmatic sending and reporting |
| Customer (dashboard exports) | `/api/v1/app/*` | session cookie + RBAC | CSV exports, invoice download |
| Admin | `/api/v1/admin/*` | session cookie + platform role | platform operations |
| Webhooks (inbound) | `/api/v1/webhooks/sms/{provider}`, `/api/v1/webhooks/payments/{provider}` | provider signature / shared secret | delivery reports, payment callbacks |
| Internal | `/api/internal/*` | `CRON_SECRET` | worker tick, health |

Every route handler goes through one wrapper (`lib/api/handler.ts`) that assigns a request ID,
authenticates, checks scopes/permissions, applies rate limits, validates input with Zod, maps
errors to the envelope, sets rate-limit headers and writes `api_logs`. The dashboard mostly uses
Server Actions, which call the same `features/*` services, so the rules are identical whichever
entry point is used.

Idempotency: `POST /sms/send` and `POST /sms/bulk` accept an `Idempotency-Key` header. The first
response is stored for 24h; a retry with the same key and body returns it unchanged, and a
different body returns `IDEMPOTENCY_CONFLICT`.

## 5. Authentication model

- **Passwords:** Argon2id (`@node-rs/argon2`), minimum 10 characters, checked against a small list
  of common passwords.
- **Sessions:** a random 32-byte token in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie. Only
  its SHA-256 hash is stored in `sessions`, so a database leak does not leak live sessions.
  7-day expiry, or 30 days with "remember me". Sessions are revocable individually or all at
  once, and are rotated at login and on password change.
- **Why not JWT?** The dashboard needs instant revocation (suspension, password change, member
  removal) and an active-organization switch; server-side sessions give both for free.
- **Verification:** email verification tokens (hashed, 24h expiry). Phone OTP (6 digits, hashed,
  10 min, 5 attempts) sent through the SMS provider when `FEATURE_PHONE_VERIFICATION=true`.
- **Password reset:** single-use hashed token, 1h expiry. Responses never reveal whether an
  email exists. All sessions are revoked on reset.
- **Brute-force protection:** per-IP and per-account rate limits; 5 failed attempts lock the
  account for 15 minutes. Every attempt is written to the audit log.
- **CSRF:** Server Actions are protected by Next.js origin checks. Cookie-authenticated route
  handlers that mutate state require a same-origin `Origin` header. The public API uses Bearer
  keys (no cookies), so it is not exposed to CSRF.
- **API keys:** format `sfk_live_<prefix>_<secret>`. Only an HMAC-SHA256 (with a server-side
  pepper) is stored. The full key is shown once. Keys carry scopes (`sms:send`,
  `messages:read`, `balance:read`, `sender_ids:read`), an optional IP allowlist and an optional
  expiry.

## 6. Authorization and multi-tenancy

- **Model:** shared database, shared schema, and an `organization_id` column on every
  customer-owned row.
- **Tenant context:** each authenticated request resolves a `TenantContext`
  `{ organizationId, userId | apiKeyId, roleKey, permissions }` from the session's active
  organization (checked against `organization_members`) or from the API key.
- **Enforcement:** feature services take a `TenantContext` as their first argument and build
  every query with `organizationId: ctx.organizationId`. Lookups by ID use
  `findFirst({ where: { id, organizationId } })`, never `findUnique({ id })`, so a foreign ID
  behaves exactly like a missing one (404, no existence leak). Integration tests assert this for
  each resource.
- **RBAC:** permissions are fine-grained keys (`campaigns:write`, `sms:send`, `billing:manage`...).
  Each organization gets its own copy of the five system roles (Owner, Admin, Manager,
  Developer, Viewer). Owners can adjust non-Owner role permissions per organization. The Owner
  role is immutable, and an organization must always keep at least one Owner.
- **Platform roles** (`USER`, `SUPPORT`, `ADMIN`, `SUPER_ADMIN`) gate `/admin` and
  `/api/v1/admin`. They are separate from organization roles, so a platform admin does not
  silently gain customer permissions; admin actions go through admin services and are audited.

## 7. Provider abstraction

Every external dependency follows the same five parts: **interface, adapter(s), configuration,
mock, replacement guide.**

```ts
interface SmsProvider {
  readonly key: string
  sendSms(input: SendSmsInput): Promise<SendSmsResult>
  sendBulkSms(inputs: SendSmsInput[]): Promise<SendSmsResult[]>
  getDeliveryStatus(providerMessageId: string): Promise<DeliveryStatusResult>
  getBalance(): Promise<ProviderBalance | null>
  validateSenderId(senderId: string, type: SenderType): Promise<SenderIdValidation>
  parseDeliveryWebhook?(req: WebhookRequest): Promise<ParsedDeliveryEvent[]>
  verifyWebhook?(req: WebhookRequest): Promise<boolean>
}
```

- `mock`: deterministic local provider for development and tests. It never contacts a network.
  Delivery outcomes are simulated by the worker and flow through the same delivery-event code
  path as real webhooks.
- `http-generic`: configurable adapter for the common Bangladeshi REST/HTTP gateway style (URL,
  key and secret, parameter mapping). **Not verified against any specific provider**; it needs
  a mapping review against the chosen provider's documentation.
- Provider selection and credentials are stored in `settings`, with secret values encrypted with
  AES-256-GCM (`SETTINGS_ENCRYPTION_KEY`) and editable by admins. Environment variables act as
  the fallback. Secrets are never sent to the browser; the admin UI shows only whether a secret
  is set.

`PaymentProvider`, `EmailProvider` and `StorageProvider` follow the same pattern. See
[`docs/05-integrations.md`](05-integrations.md).

## 8. Message lifecycle

```
API / composer / campaign
   │  validate recipients (BD E.164), sender ID approved, content rules, suppression (promotional),
   │  daily/monthly limits, balance
   ▼
cost = segments × recipients × rate(smsType, senderType, plan)
   │  wallet debited atomically (UPDATE ... WHERE balance >= cost)
   ▼
messages: QUEUED ──worker──► SUBMITTED ──webhook/poll──► DELIVERED
                     │                          └──────► FAILED / EXPIRED / REJECTED (refund per policy)
                     └─ provider error ─► retry with backoff (max attempts) ─► FAILED (refund)
```

Each transition appends a `message_events` row with a dedupe key. Status only moves forward
(a late `SUBMITTED` never overwrites `DELIVERED`). Campaign counters are recomputed from message
aggregates, so they stay correct after replays.
