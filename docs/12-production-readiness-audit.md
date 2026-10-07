# 12 — Final production readiness + cutover audit (Laravel API)

Audit date: 2026-10-07. Scope: `backend/` (Laravel 12) replacing the Prisma data layer of the
Next.js app, which still runs production against the same MySQL/MariaDB database.

Ground rules applied during this audit: the frontend was **not** switched, Prisma was **not**
removed, no Next.js API route was deleted, the production database and production
authentication were **not** touched, no migration was run anywhere but the local test database, no
real SMS was sent and no real payment was made. Production was only probed with anonymous,
read-only GET requests. Secret values are never printed; where a check needed secrets, generated
test values were used.

"Tests pass" is **not** treated as "production ready". Anything that could not be observed is
marked **UNVERIFIED**.

**Verdict: NO-GO.** The Laravel code is complete and well tested, but three external facts that
decide whether money and messages are handled correctly in production have never been verified:
the real SMS provider, SSLCommerz, and the production deployment itself (database reachability,
cron, backups). See [§30](#30-go-live-gate) and [Final output](#final-output).

---

## Contents

1. [Readiness table](#1-readiness-table)
2. [Real SMS provider](#2-real-sms-provider)
3. [SSLCommerz](#3-sslcommerz)
4. [Auth cutover](#4-auth-cutover)
5. [Shared secrets](#5-shared-secrets)
6. [API contract compatibility](#6-api-contract-compatibility)
7. [Server actions](#7-server-actions)
8. [Direct Prisma access](#8-direct-prisma-access)
9. [Laravel API client in Next.js](#9-laravel-api-client-in-nextjs)
10. [CORS and cookies](#10-cors-and-cookies)
11. [CSRF](#11-csrf)
12. [Queue and worker](#12-queue-and-worker)
13. [Hostinger deployment](#13-hostinger-deployment)
14. [Environment checklist](#14-environment-checklist)
15. [Mock / test provider safeguards](#15-mock--test-provider-safeguards)
16. [Wallet financial ledger](#16-wallet-financial-ledger)
17. [SMS duplication](#17-sms-duplication)
18. [Delivery status state machine](#18-delivery-status-state-machine)
19. [API security and IDOR](#19-api-security-and-idor)
20. [API key security](#20-api-key-security)
21. [Webhook security](#21-webhook-security)
22. [Data privacy](#22-data-privacy)
23. [Performance](#23-performance)
24. [Error handling](#24-error-handling)
25. [Observability](#25-observability)
26. [Backup](#26-backup)
27. [Rollback](#27-rollback)
28. [Smoke tests](#28-smoke-tests)
29. [Changes made during this audit](#29-changes-made-during-this-audit)
30. [Go-live gate](#30-go-live-gate)
- [Final output](#final-output)
- [Appendix A — Prisma function inventory](#appendix-a--prisma-function-inventory)

---

## 1. Readiness table

Statuses: READY · READY WITH CONFIGURATION · BLOCKED · NOT IMPLEMENTED · UNVERIFIED.

| FEATURE | STATUS | EVIDENCE | REQUIRED BEFORE GO-LIVE |
|---|---|---|---|
| Schema compatibility (42 models, no migrations on prod tables) | READY | `ModelsTest` (column/relation reflection against the real schema), `BaselineSchemaTest` | Run `php artisan migrate --pretend` on prod: must list only Laravel's own tables (`jobs`, `failed_jobs`, `cache*`, `job_batches`) |
| Login / register / logout / password / email verify | READY | `AuthTest`, `AuthCutoverTest` | — |
| Existing Next.js sessions accepted by Laravel | READY | `AuthCutoverTest` (Node-format row → `/auth/me` → org → permissions → logout) | — |
| Argon2id passwords PHP ⇄ Node | READY | Cross-language check (§4): PHP hash verifies in `@node-rs/argon2`, Node hash verifies in PHP, no rehash | — |
| Phone OTP | READY WITH CONFIGURATION | `AuthTest` | Real SMS provider (§2) |
| Roles / permissions / tenant isolation | READY | `AuthCutoverTest`, `IdorSweepTest` (736 assertions), `SecurityTest` | — |
| Contacts, groups, import, suppression | READY | `ContactTest` | Copy existing upload dir (§13) |
| Templates, sender IDs (+ documents) | READY WITH CONFIGURATION | `DashboardModulesTest`, `SecurityTest` | Copy `LOCAL_DATA_DIR/storage/orgs` to `backend/storage/app/private/orgs` |
| Campaigns (draft, estimate, submit, schedule, pause/resume/cancel/retry) | READY | `CampaignTest` | — |
| Customer API `/sms/*`, `/messages`, `/balance`, `/sender-ids` | READY | `SmsApiTest`, OpenAPI `backend/docs/openapi-public.yaml` | — |
| Real SMS delivery | **UNVERIFIED** | Only a generic HTTP adapter exists (`HttpSmsProvider::verified() === false`), same as Node | Provider docs + credentials + end-to-end test with own numbers (§2) |
| Duplicate-SMS protection | READY | `DuplicateSendTest` (7 tests) | — |
| Delivery reports (webhook + poll) | READY WITH CONFIGURATION | `DeliveryAndWebhookTest` | Provider DLR format (§2), webhook secret |
| Wallet debit / credit / refund | READY | `WalletConcurrencyTest` (10 concurrent PHP processes), `DeliveryAndWebhookTest` | — |
| Manual payments + admin approval | READY | `PaymentTest` | — |
| SSLCommerz | **UNVERIFIED** | `SslCommerzCallbackTest` against faked validation API (8 tests); never run against sandbox | Sandbox run: success, fail, cancel, IPN reachability (§3) |
| Mock SMS / mock payments refused in production | READY | `ProductionSafeguardsTest` | `APP_ENV=production`, `ALLOW_MOCK_PAYMENTS` unset |
| Admin panel API | READY | `AdminTest` | — |
| Reports + CSV exports | READY | `DashboardModulesTest` | Browser downloads need Next proxies (§10) |
| Outbound customer webhooks | READY | `SecurityTest` (SSRF), `DeliveryAndWebhookTest` | — |
| Scheduler / worker | **UNVERIFIED** on Hostinger | `sms:work`, heartbeat + readiness check | Cron entry, `proc_open` availability (§12) |
| Email delivery | READY WITH CONFIGURATION | `TransactionalMail` + queue | SMTP credentials; queue worker via scheduler |
| Production deployment of `backend/` | **BLOCKED** | Probe: deployed build answers health only; database unreachable from it | Redeploy current code, fix DB credentials/host (§13) |
| Readiness probe | READY | `ProductionSafeguardsTest` | Monitor `/api/v1/internal/ready` |
| Frontend connected to Laravel | NOT IMPLEMENTED (by instruction) | `src/lib/laravel-api.ts` exists, imported nowhere | Feature-by-feature switch (§7, §27) |
| Backups / restore drill | **UNVERIFIED** | No evidence of a tested restore | Take + restore a dump before cutover (§26) |
| Client IP behind Cloudflare | UNVERIFIED | `TRUSTED_PROXIES` empty by default | Confirm what `REMOTE_ADDR` Hostinger passes; set Cloudflare ranges if needed |

---

## 2. Real SMS provider

**Status: UNVERIFIED — REQUIRES REAL PROVIDER CREDENTIALS/DOCUMENTATION.**

No provider name, API document, account or credential exists anywhere in the repository, in either
app. The Node app's `http-provider.ts` is itself labelled "unverified scaffolding". Laravel ports it
1:1 and adds stricter outcome handling. No provider field was invented.

| Concern | Next.js (Node) | Laravel | Same? |
|---|---|---|---|
| Adapter | `services/sms/http-provider.ts` | `Services/Sms/Providers/HttpSmsProvider.php` | Yes |
| Request | `POST` form: `api_key`, `api_secret?`, `to` (8801…), `msg`, `sender_id`, `type` (text/unicode); names remappable in Admin → SMS provider | Same params, same remapping (`sms.provider.mapping` setting) | Yes |
| Success detection | `{error:0}` / `{success:true}` / `status∈{success,ok,sent,queued}` + an id | Same | Yes |
| Provider message id | `data.request_id` / `message_id` / `id` / `request_id` | Same | Yes |
| Concurrency | 5 parallel | 5 parallel (`Http::pool`) | Yes |
| Timeouts | total timeout | connect ≤5 s + total `SMS_PROVIDER_TIMEOUT` | Laravel stricter |
| Network error before send | retry | retry (`NETWORK_ERROR`) | Yes |
| Read timeout / dropped after send | **retry (duplicate risk)** | **FAILED, refunded, never resent** (`PROVIDER_TIMEOUT`) | Laravel safer |
| HTTP 429 / 503 | retry | retry | Yes |
| Other 5xx | retry (duplicate risk) | FAILED unconfirmed, not resent | Laravel safer |
| Delivery report webhook | `X-Signature` HMAC-SHA256 or `?token=` | Same; never unsigned | Yes |
| DLR status mapping | generic words (delivered/failed/…) | Same table | Yes |
| Polling | `deliveryStatus()` → UNKNOWN (not implemented) | Same | Yes |
| Balance check | not implemented | not implemented | Yes |
| Sender-ID validation | local rules only | Same | Yes |

Required before go-live:
1. The provider's official API document (send, DLR webhook format + signature, status codes,
   number format, Unicode handling, rate limits, error codes).
2. Adjust `interpretSendResponse()` and `parseDeliveryWebhook()` to that document, add a contract
   test with recorded real responses, then flip `verified()` to `true`.
3. A paid end-to-end test with **your own numbers** on each operator (GP, Robi/Airtel, Banglalink,
   Teletalk): GSM + Bangla text, masking + non-masking, DLR received and applied.
4. Configure `SMS_PROVIDER_WEBHOOK_SECRET` and register
   `https://<api-host>/api/v1/webhooks/sms/http` with the provider.

---

## 3. SSLCommerz

**Status: UNVERIFIED** (implemented from public v4 docs; never run against a sandbox or live store).

Rule enforced: **nothing the browser or the IPN body says can credit a wallet.** Credit happens only
after a server-to-server call to the validation API returns all of:

| Check | Where | Test |
|---|---|---|
| `status ∈ {VALID, VALIDATED}` from the **validation API** (not the form) | `SslCommerzProvider::handleCallback` | forged VALID form + INVALID validation → not credited |
| `tran_id` equals our payment id | same | different transaction → not credited |
| `currency === 'BDT'` | same | USD → not credited |
| `amount` present and numeric (**made mandatory in this audit**) | same + `PaymentCallbackService` | amount missing → not credited, logged |
| `amount == payment.total` (bcmath) | `PaymentService::complete` | amount mismatch → not credited |
| Idempotent completion (row lock + conditional `UPDATE … WHERE status IN (PENDING, AWAITING_VERIFICATION)` + unique ledger reference) | `PaymentService::complete` | IPN replay + browser return → credited once |
| Fail/cancel callbacks cannot change state (unauthenticated) | `PaymentCallbackService` | failure/cancel → payment stays PENDING, no validation call |
| Disabled / unconfigured gateway ignores callbacks | `PaymentProviderManager` | → `unsupported`, no HTTP call |

Not implemented (needs SSLCommerz confirmation, **not guessed**): `verify_sign` / `verify_key` hash
check of the IPN, `risk_level`/`risk_title` handling (hold risky payments for review), and
refund API. The validation API check makes the signature optional for safety, but a risk policy is
a business decision.

Required before go-live: sandbox store; run success, failure, cancel, IPN-only (close browser),
duplicate IPN, amount tampering in the initiation request; confirm the IPN reaches
`https://<api-host>/api/v1/webhooks/payments/sslcommerz` through Cloudflare (no bot challenge on
that path); set the store's IPN URL; then live credentials with `live=true`.

---

## 4. Auth cutover

Architecture after cutover: the browser keeps the existing `__Host-sf_session` cookie on the Next.js
domain. Next.js server code reads it and calls Laravel server-to-server with
`Authorization: Bearer <token>`. Laravel resolves the **same `sessions` row**
(`tokenHash = sha256(token)`). No re-login, no new cookie, no Sanctum.

| Aspect | Next.js | Laravel | Compatible |
|---|---|---|---|
| Token | 32 random bytes, base64url (43 chars) | same generator | ✅ tested |
| Storage | `sessions.tokenHash` = sha256 hex | same | ✅ tested both directions |
| Expiry | 7 d / 30 d (remember me) | same | ✅ |
| `lastSeenAt` touch | every 5 min | same | ✅ tested |
| Invalidation on password change (`passwordChangedAt > createdAt`) | yes | yes | ✅ tested |
| Disabled user / disabled membership | 401 / no org | same | ✅ tested |
| Active org not a membership → fallback to own org | yes | yes | ✅ tested |
| Staff session without org → admin | yes | yes | ✅ tested |
| Logout deletes the row (both apps see it) | yes | yes | ✅ tested |
| Password hash argon2id m=19456,t=2,p=1 | `@node-rs/argon2` | `password_hash` | ✅ cross-verified, no rehash |
| Login rate limit per IP | browser IP | Next server IP **unless** forwarded (fixed: §29) | ✅ tested |

Integration test: `backend/tests/Feature/AuthCutoverTest.php` writes a session row exactly as
`session-store.ts createSession()` does, then walks `/auth/me` → org-scoped `/app/contacts` →
VIEWER denied writes and `billing:read` → another org's contact 404 → logout deletes the row →
password-change invalidation → disabled membership.

Login after cutover: the Next `loginAction` calls `POST /auth/login` (with the forwarded IP), receives
`data.token` and `data.expiresAt`, and sets the same cookie itself. Laravel never sets cookies.

---

## 5. Shared secrets

Values were never printed. Compatibility was checked with generated test secrets by running the
real Node helpers (`src/lib/crypto.ts`, `src/lib/auth/password.ts`) against real PHP output, both
directions.

| SECRET | NEXT.JS USAGE | LARAVEL USAGE | COMPATIBLE? | ACTION |
|---|---|---|---|---|
| `AUTH_SECRET` | phone OTP HMAC (`id:code`) | same (`config smsflow.auth_secret`) | ✅ (unit fixture) | Copy identical value |
| `API_KEY_PEPPER` | `HMAC-SHA256(pepper, fullKey)` | same | ✅ cross-run | Copy identical value — otherwise every customer API key breaks |
| `SETTINGS_ENCRYPTION_KEY` | AES-256-GCM `v1.iv.tag.ct`, base64-32-byte or sha256-derived | same, both key forms | ✅ cross-run both forms, both directions | Copy identical value — otherwise provider credentials in `settings` become unreadable |
| `CRON_SECRET` | `/api/internal/worker/tick` | `/internal/worker/tick`, `/internal/ready` | ✅ | May differ; keep secret |
| `FRONTEND_PROXY_SECRET` | `laravel-api.ts` (unused yet) | `AssignRequestContext` | ✅ tested | **New**: generate ≥32 chars, set on both servers |
| `SMS_PROVIDER_*` | env fallback | env fallback | ✅ | DB settings take precedence on both |
| `PAYMENT_PROVIDER_KEY/SECRET` | SSLCommerz store | SSLCommerz store | ✅ | — |
| `APP_KEY` | — | Laravel encryption (not used for app data) | n/a | `php artisan key:generate` once |
| `DATABASE_URL` / `DB_*` | Prisma | Laravel | n/a | Same database, same user is fine |

---

## 6. API contract compatibility

| Surface | Next.js | Laravel | Compatible | Notes |
|---|---|---|---|---|
| Customer API `/api/v1/sms/send`, `/sms/bulk`, `/sms/estimate`, `/messages`, `/messages/{id}`, `/balance`, `/sender-ids` | route handlers | same paths, same snake_case bodies, same status codes | ✅ | Customers only change the host. Covered by `SmsApiTest` + OpenAPI file |
| `Idempotency-Key` | supported | supported (same replay semantics) | ✅ | |
| Error envelope `{success:false,error:{code,message,details},meta.requestId}` | yes | yes | ✅ | Validation details: `details.fields[{path,message}]` and `details.field` |
| Auth routes `/api/v1/auth/*` | route handlers | same paths + aliases | ✅ | Laravel returns the token in JSON instead of setting a cookie |
| Admin route handlers `/api/v1/admin/*` | 6 routes | same paths and shapes | ✅ | |
| Dashboard exports `/api/v1/app/*/export` | same-origin, cookie-auth | same paths, **Bearer only** | ⚠ | Browser links must go through Next route handlers that proxy with the cookie's token (§10) |
| Webhooks `/api/v1/webhooks/sms/*`, `/webhooks/payments/*`, `/payments/*/return` | yes | same paths | ✅ | Update URLs registered at provider/SSLCommerz to the API host |
| Cron `/api/internal/worker/tick` | yes | `/api/v1/internal/worker/tick` | ⚠ path differs | Prefer `schedule:run` cron |
| Health `/api/health` | yes | `/api/v1/health` | ⚠ path differs | Update monitors |
| Dashboard data (server actions/RSC) | Prisma directly | `/api/v1/app/*` (187 routes total) | ✅ endpoints exist | Requires frontend change (§7) |

---

## 7. Server actions

78 server actions in 12 files. **Every one has a Laravel endpoint (backend: MIGRATED).** None was
changed (instruction). Classification of the *Next.js side*:

| FILE | ACTIONS | LARAVEL ENDPOINT(S) | CLASSIFICATION |
|---|---|---|---|
| `features/auth/actions.ts` | loginAction, registerAction, logoutAction, forgotPasswordAction, resetPasswordAction, resendVerificationAction, sendOtpAction, verifyOtpAction, changePasswordAction, switchOrganizationAction, setLocaleAction, createOrganizationAction | `/auth/login`, `/auth/register`, `/auth/logout`, `/auth/password/forgot`, `/auth/password/reset`, `/auth/email/resend`, `/auth/phone/otp`, `/auth/phone/verify`, `PUT /profile/password`, `/auth/switch-organization`, `PUT /profile/locale`, `/auth/organizations` | REQUIRES FRONTEND CHANGE (keep cookie handling in Next) |
| `features/campaigns/actions.ts` | saveDraftAction, estimateAction, submitAction, campaignOpAction, editDraftAction | `/app/campaigns`, `/estimate`, `/submit` (send `Idempotency-Key`), `/{id}/{pause,resume,cancel,retry,duplicate,send,schedule}`, `PUT /{id}` | REQUIRES FRONTEND CHANGE |
| `features/contacts/actions.ts` | saveContactAction, bulkContactsAction, deleteContactAction, importContactsAction, saveGroupAction, deleteGroupAction, addSuppressionAction, removeSuppressionAction | `/app/contacts*`, `/app/contacts/bulk`, `/app/contacts/import` (multipart), `/app/contact-groups*`, `/app/suppression*` | REQUIRES FRONTEND CHANGE |
| `features/developers/actions.ts` | createApiKeyAction, revokeApiKeyAction, createWebhookAction, webhookOpAction | `/app/api-keys*`, `/app/webhooks*` | REQUIRES FRONTEND CHANGE |
| `features/public/actions.ts` | submitContactRequest, submitAbuseReport | `/public/contact`, `/public/abuse-reports` | REQUIRES FRONTEND CHANGE |
| `features/sender-ids/actions.ts` | requestSenderIdAction, setDefaultSenderIdAction, withdrawSenderIdAction | `POST /app/sender-ids` (multipart), `PUT /app/sender-ids/{id}`, `DELETE /app/sender-ids/{id}` | REQUIRES FRONTEND CHANGE |
| `features/settings/actions.ts` | updateProfileAction, updateOrganizationAction, revokeSessionAction, saveNotificationPrefsAction, markNotificationsReadAction, leaveOrganizationAction | `PUT /profile`, `PUT /app/organization`, `DELETE /profile/sessions/{id}`, `PUT /profile/notification-preferences`, `/app/notifications/read`, `/app/organization/leave` | REQUIRES FRONTEND CHANGE |
| `features/support/actions.ts` | createTicketAction, replyTicketAction, closeTicketAction | `/app/support/tickets*` | REQUIRES FRONTEND CHANGE |
| `features/team/actions.ts` | inviteAction, revokeInviteAction, changeRoleAction, memberStatusAction, updateRolePermissionsAction, acceptInviteAction, inviteSignupAction | `/app/team/*`, `/auth/invitations/accept`, `/auth/invitations/signup` | REQUIRES FRONTEND CHANGE |
| `features/templates/actions.ts` | saveTemplateAction, deleteTemplateAction | `/app/templates*` | REQUIRES FRONTEND CHANGE |
| `features/wallet/actions.ts` | previewTopUpAction, startCheckoutAction, submitReferenceAction, cancelPaymentAction, updateThresholdAction, mockCheckoutAction | `/app/payments/preview`, `/app/payments` (send `Idempotency-Key`), `/{id}/reference`, `/{id}/cancel`, `PUT /app/wallet/threshold`, `/{id}/mock-complete` | REQUIRES FRONTEND CHANGE (mockCheckoutAction: CAN BE DELETED AFTER CUTOVER in prod builds) |
| `features/admin/actions.ts` | 20 actions (org controls/status, wallet adjust, campaign/sender-ID/payment review, tickets, user access, abuse, leads, plans, packages, policies, SMS provider, payments, site content, blocklist) | `/admin/*` (one endpoint each) | REQUIRES FRONTEND CHANGE |

STILL PRISMA: all 78 until switched. Next route handlers under `src/app/api/v1/{sms,messages,balance,sender-ids,webhooks,payments,auth,internal}` → CAN BE DELETED AFTER CUTOVER (once DNS/provider URLs point to Laravel). Export handlers under `src/app/api/v1/app/*` → REQUIRES FRONTEND CHANGE (become proxies, §10).

---

## 8. Direct Prisma access

Measured by scanning every `db|tx.<model>.<operation>(` call and `$transaction/$queryRaw/$executeRaw`
in `src/` (excluding the generated client `src/generated/prisma`):

**471 Prisma operations in 58 files across 219 functions.** (The earlier rough count of 579 in 72
files used a looser pattern that also counted imports and type references; the per-call count
above is the one to track.)

| Area | Operations |
|---|---|
| `features/admin` + `app/admin` | 91 |
| `services/messaging` (send, dispatch, worker, delivery) | 66 |
| `features/contacts` | 50 |
| `features/auth` + `lib/auth` | 43 |
| `features/team` | 32 |
| `features/campaigns` | 30 |
| `services/billing` + `features/wallet` + `services/payments` | 39 |
| everything else (developers, settings, reports, sender-ids, support, templates, organizations, dashboard, api, rate-limit, notify, public, audit) | 120 |

Every function is listed with its Laravel endpoint in [Appendix A](#appendix-a--prisma-function-inventory).
**Prisma removal is possible only when this count reaches 0** (plus `prisma/` schema, `@prisma/*`
packages, `postinstall`/build steps). Until then both stacks write the same tables; this is safe
because Laravel uses the same row-level semantics (conditional updates, unique ledger refs, the
same lease/marker columns) — **but the Node worker and the Laravel worker must never both run
against production** (different duplicate-send rules; see §17).

---

## 9. Laravel API client in Next.js

Created: `src/lib/laravel-api.ts` (server-only, **imported nowhere**; `tsc --noEmit` and ESLint clean).

- One base URL: `LARAVEL_API_URL`; optional `LARAVEL_API_TIMEOUT_MS` (default 15 s) via `AbortSignal.timeout`.
- Auth: Bearer from the existing session cookie (`__Host-sf_session` / `sf_session`); `auth:false` for public calls; `token` override right after login.
- Forwards browser IP (`X-SMSFlow-Client-IP` + `X-SMSFlow-Proxy-Secret`), user agent, `Accept-Language`, `Idempotency-Key`.
- JSON bodies, or `FormData` passed through as multipart (imports, sender-ID documents).
- Errors → `LaravelApiError{kind,status,code,details,requestId,retryAfterSeconds,fieldErrors}`:
  401 unauthenticated · 402 insufficient_balance · 403 forbidden · 404 not_found · 409 conflict ·
  422 validation (`fieldErrors` from `details.fields`/`details.field`) · 429 rate_limited ·
  500 server (generic message) · 502/503/504/timeout/network unavailable.
- Retries: **GET/HEAD only**, on network errors and 502/503/504, max 2, exponential backoff with jitter. Writes are never retried automatically.
- `toActionResult()` / `laravelActionError()` produce the existing `ActionResult` shape so forms keep inline field errors.
- `redirect: "manual"`, `cache: "no-store"`.

---

## 10. CORS and cookies

- Dashboard traffic is **server-to-server** (Next server → Laravel). CORS does not apply.
- Laravel CORS (`config/cors.php`) allows only `FRONTEND_URL` origins, no credentials; tested by `SecurityTest::test_cors_is_limited_to_the_frontend`.
- Cookies: Laravel sets none (stateless `SESSION_DRIVER=array`; readiness fails if `database`, because `sessions` is the app's table). The `__Host-` cookie cannot be shared across subdomains by design — therefore:
- ⚠ **Browser downloads** (contacts/campaign/report/transaction exports, sender-ID documents) currently link to same-origin Next routes. After cutover those Next route handlers must stay as thin proxies (`laravelFetch` → stream body + `Content-Disposition`). Laravel's paths are identical, including the `app/transactions/export` alias added in this audit.

## 11. CSRF

Not applicable to Laravel: no cookie authentication is accepted (Bearer only, API middleware group,
no `VerifyCsrfToken`). Server actions keep Next.js's built-in Origin check. Payment returns and
webhooks are authenticated by gateway validation/signature, not by cookies.

---

## 12. Queue and worker

| Item | Design | Status |
|---|---|---|
| SMS sending | `messages` table is the queue; lease (`lockedUntil`), attempts, in-flight marker; `sms:work` every minute (and inline dispatch after a send) | READY |
| Campaign launch | due campaigns launched by the same tick (claim makes double launch impossible) | READY |
| Delivery polling, webhook redelivery, campaign finalize | same tick | READY |
| Laravel queue (`database`) | mail, contact imports > 512 KB, campaign launch job | READY WITH CONFIGURATION |
| Queue worker on shared hosting | `queue:work --stop-when-empty --max-time=55` from the scheduler (`QUEUE_WORKER_VIA_SCHEDULER=true`) | UNVERIFIED on Hostinger |
| Housekeeping | `app:housekeeping` every 10 min | READY |
| Overlap protection | `withoutOverlapping` + `onOneServer` (cache locks in DB) + row-level claims | READY |
| Heartbeat | `sms:worker:last-tick` cache key; `/internal/ready` fails in production if >5 min old | READY |

Exact cron (Hostinger hPanel → Advanced → Cron Jobs, every minute):

```
* * * * * cd /home/<user>/domains/<api-domain>/backend && /usr/bin/php artisan schedule:run >> /dev/null 2>&1
```

(Use the PHP 8.3 CLI path that hPanel shows for the domain — the exact path is UNVERIFIED; check with `which php` over SSH.)
`runInBackground()` requires `proc_open`/`exec` — **UNVERIFIED** on the plan. If disabled, remove
`runInBackground()` (SMS still works; ticks just run sequentially). Fallback without cron: an
external pinger calling `POST /api/v1/internal/worker/tick` with `Bearer CRON_SECRET`.

Node side: the Next.js in-process worker (`WORKER_IN_PROCESS`) and its tick route **must be disabled
at the moment Laravel's scheduler starts** (§17, §27).

---

## 13. Hostinger deployment

Observed (anonymous GET probes, earlier in this audit): PHP 8.3.33, Cloudflare in front, HTTP→HTTPS
redirect works, `.env`/`composer.json`/`storage/` not exposed. **The deployed backend is an old build
(only `/health`) and reported the database unreachable.** The document root is rewrite-based
(`/index.php` reachable) — whether it points at `backend/public` is UNVERIFIED.

Commands (SSH, in `backend/`), after uploading the current code:

```
composer install --no-dev --optimize-autoloader --no-interaction
php artisan key:generate --force            # first deploy only
php artisan migrate --pretend --force       # MUST list only Laravel's own tables
php artisan migrate --force                 # only after reviewing the pretend output
php artisan storage:link                    # not needed for documents (private disk)
php artisan config:cache && php artisan route:cache && php artisan event:cache
php artisan sms:work                        # one manual tick; check storage/logs
curl -s -H "Authorization: Bearer $CRON_SECRET" https://<api-host>/api/v1/internal/ready
```

Also: document root → `backend/public`; `storage/` and `bootstrap/cache/` writable; copy existing
sender-ID documents `<Next LOCAL_DATA_DIR>/storage/orgs/` → `backend/storage/app/private/orgs/`
(same key layout; or point both at the same S3 bucket); Cloudflare: no bot challenge / cache on
`/api/*`; `TRUSTED_PROXIES` per §14.

`env()` outside `config/`: **none** (checked `app/`, `routes/`, `bootstrap/`), so `config:cache` is safe.

## 14. Environment checklist

REQUIRED (production): `APP_ENV=production`, `APP_DEBUG=false`, `APP_KEY`, `APP_URL`, `FRONTEND_URL`,
`DB_HOST/PORT/DATABASE/USERNAME/PASSWORD`, `AUTH_SECRET`, `API_KEY_PEPPER`, `SETTINGS_ENCRYPTION_KEY`
(all three identical to Next), `CRON_SECRET`, `FRONTEND_PROXY_SECRET`, `SESSION_DRIVER=array`,
`CACHE_STORE=database`, `QUEUE_CONNECTION=database`, `QUEUE_WORKER_VIA_SCHEDULER=true`,
`MAIL_MAILER=smtp` + `MAIL_*`, `SMS_PROVIDER=http` + `SMS_PROVIDER_URL/API_KEY` (or Admin settings),
`SMS_PROVIDER_WEBHOOK_SECRET`, `PAYMENT_PROVIDERS` (e.g. `manual,sslcommerz`).

OPTIONAL: `TRUSTED_PROXIES` (Cloudflare ranges if Hostinger does not restore the visitor IP —
UNVERIFIED), `DB_ISOLATION_LEVEL`, `SMS_PROVIDER_API_SECRET`, `SMS_PROVIDER_TIMEOUT`,
`SMS_WORKER_*`, `SMS_INLINE_DISPATCH`, rate-limit overrides, `DOCUMENTS_DISK`/`AWS_*`, `SITE_*`,
`FEATURE_*`, `LOG_LEVEL=warning`, `PAYMENT_PROVIDER_KEY/SECRET/LIVE` (or Admin settings).

DEV only: `SMS_PROVIDER=mock`, `ALLOW_MOCK_PAYMENTS=true`, `MAIL_MAILER=log`, `APP_DEBUG=true`.
TEST only: values in `backend/phpunit.xml` (fake secrets, sqlite/mysql test DB).

Next.js additions at cutover: `LARAVEL_API_URL`, `FRONTEND_PROXY_SECRET`, `WORKER_IN_PROCESS=false`.

---

## 15. Mock / test provider safeguards

| Safeguard | Behaviour in `APP_ENV=production` | Test |
|---|---|---|
| Mock SMS provider selected | `sendingProvider()` throws `503 PROVIDER_NOT_CONFIGURED` **before charging**: API send/bulk, campaign submit, OTP | `ProductionSafeguardsTest` |
| Worker with mock provider | claims nothing, launches nothing, polls nothing (no fake DELIVERED); messages stay QUEUED | same |
| Mock payments | provider hidden from methods, creation rejected, `mock-complete` 403 | same |
| Readiness | 503 with `smsProvider`, `smsWebhookSecret`, `scheduler`, `mockPaymentsOff`, `debugOff`, `mailer` checks | same |
| Unverified HTTP adapter | allowed (it is the real path) but readiness says `ok (adapter not verified against the provider)` | — |

## 16. Wallet financial ledger

| Flow | Ledger reason | Reference (unique `reason,referenceType,referenceId`) | Mechanism |
|---|---|---|---|
| Top-up (online/manual approved) | TOPUP | `payment:<id>` | row lock + conditional status update + credit |
| Single/bulk API send | SMS_CHARGE | `message:<id>` / `batch:<id>` | `UPDATE wallets SET balance=balance-? WHERE balance>=?` |
| Campaign launch | SMS_CHARGE | `campaign:<id>` | same, once per campaign (claim) |
| Failed/rejected/unconfirmed/cancelled message | REFUND | `message:<id>` + `refundedAt` | inside the status transition, once |
| Sender-ID fee | SENDER_ID_FEE | `sender_id:<id>` | conditional debit |
| Admin adjustment | ADJUSTMENT | generated id, audited | conditional debit / credit |

Concurrency re-run: `WalletConcurrencyTest` — 10 parallel PHP processes racing debits never
overspend; duplicate reference rejected; balance never negative (DB `CHECK` + conditional update).
All money in bcmath strings, `DECIMAL(14,4)`.

Known trade-off (YELLOW): an **unconfirmed** send is refunded; if the provider did deliver it, the
customer got that SMS free and the late DLR is ignored (terminal state). Revenue leak only, never a
double charge or a double SMS.

## 17. SMS duplication

| Scenario | Outcome |
|---|---|
| Two workers / overlapping cron | row-locked lease; second worker claims nothing (tested) |
| DNS / connect refused / connect timeout | never reached provider → retried with backoff, max 4 attempts |
| 429 / 503 | provider refused → retried |
| Read timeout, connection reset, empty reply, other 5xx | **unconfirmed → FAILED + refunded, never resent** (tested with `Http::fake`) |
| Worker crash after in-flight marker | `failInterruptedSends()` closes it as `SEND_INTERRUPTED`, never resent (tested) |
| Worker crash before marker | lease expires → safely retried (tested) |
| Customer API retry | `Idempotency-Key` replays the first response (tested) |
| Dashboard double-click on campaign submit / payment | requires `Idempotency-Key` from the frontend — **must be sent by the cutover actions** |
| Node and Laravel workers both running | **duplicate risk** (Node retries ambiguous timeouts) → only one worker may run (§27) |

## 18. Delivery status state machine

Forward-only, enforced in `DeliveryService::apply` with a conditional update on the previous status
and unique `message_events.dedupeKey`:

```
QUEUED ──► SUBMITTED ──► DELIVERED
  │            ├──────► FAILED / REJECTED / EXPIRED
  ├──────────► DELIVERED / FAILED / REJECTED / EXPIRED
  └──────────► CANCELLED
```

Terminal states never change. Duplicate DLRs (same event) are applied once; out-of-order DLRs
cannot move a message backwards. Refund only on failure from QUEUED, or from SUBMITTED when the
billing policy `refundFailedMessages` is on. EXPIRED after 72 h without report: no refund.

## 19. API security and IDOR

- `IdorSweepTest` (new): all 48 parameterised `/api/v1/app/*` routes (the org-local `team/roles/{role}` key excluded) × every method × 16 kinds of
  another organization's ids (contact, group, template, campaign, message, API key, sender ID,
  webhook, ticket, suppression, invitation, member, payment, invoice, transaction, import) — **736
  assertions, no 2xx**, and organization B's rows are byte-identical afterwards. New routes are
  covered automatically.
- Found and fixed: `DELETE /app/contacts/{id}` answered 200 for a foreign/nonexistent id (no data
  touched — the delete was org-scoped) → now 404.
- Admin routes: `platform:` permission middleware; `AdminTest` covers role denial.
- Mass assignment: privileged columns guarded (`ModelsTest`), services use explicit `forceFill`.
- Strict request bodies on the customer API (unknown fields → 422).

## 20. API key security

Stored as HMAC-SHA256(pepper, key), shown once, prefix lookup + constant-time compare, scopes,
IP allowlist, expiry, revocation, `lastUsedAt` throttled, per-key rate limits, suspended-org denial
(`SmsApiTest::test_api_key_errors`, `SecurityTest`). Same pepper as Node, so existing keys keep
working (cross-run check, §5).

## 21. Webhook security

Inbound SMS DLR: HMAC `X-Signature` over the raw body or `?token=`, constant time, never unsigned;
`inbound_webhook_events.eventKey` unique (replay → once). Payments: gateway validation (§3).
Outbound customer webhooks: HTTPS only, SSRF-safe URL check incl. DNS resolution to private ranges
(`SecurityTest`), HMAC-signed with a per-webhook secret, retries with backoff.

## 22. Data privacy

- Phone numbers masked in logs (`Phone::mask`), secrets never returned (`SecurityTest`), settings secrets encrypted at rest, documents on a private disk served only through tenant/admin-checked endpoints.
- YELLOW: `QueryException` messages may contain bound values (phone, message body) in `laravel.log` on DB errors. Mitigation: `LOG_LEVEL=warning`, restrict log access, rotate (`LOG_STACK=daily`, 14 days).
- Message bodies are stored in plaintext (same as Node) — business decision.

## 23. Performance

- Indexed lookups for sessions (`tokenHash`), API keys (`prefix`), messages queue (`status,nextAttemptAt`), events (`dedupeKey`).
- Batch dispatch (100/claim, 5 concurrent provider calls), worker time budget.
- YELLOW: campaign audience resolution loads up to 200k recipients in memory (same as Node). On shared hosting set `memory_limit ≥ 512M` for CLI or cap campaign size.
- YELLOW: rate limits and cache are DB-backed (no Redis on shared hosting) — fine for current volume, watch `rate_limit_buckets` size (housekeeping purges).

## 24. Error handling

Uniform envelope with `requestId`; unexpected errors → generic 500 message, details only in logs
(`SecurityTest`); `AppException` codes map to fixed statuses; provider/DB unavailability → 503;
the client maps all of them (§9).

## 25. Observability

Request id on every response and log line; structured logs for provider responses (masked),
dispatch outcomes, unconfirmed sends, payment callbacks; audit log table for admin/security actions;
`/api/v1/health` (public) and `/api/v1/internal/ready` (secret) for uptime monitoring.
Missing (YELLOW): alerting. Configure an external monitor on `/internal/ready` (alert on non-200)
and on `laravel.log` errors.

## 26. Backup

**UNVERIFIED.** No evidence of a tested restore. Before cutover:
1. Full logical dump: `mysqldump --single-transaction --routines --triggers --hex-blob <db> | gzip > pre-cutover-<date>.sql.gz` (off-server copy).
2. Restore it into a scratch database and run `php artisan test`-style read checks / row counts.
3. Copy the upload directory (`LOCAL_DATA_DIR/storage`).
4. Confirm Hostinger's automatic backup schedule and retention in hPanel.

## 27. Rollback

The cutover never changes the schema of existing tables and both apps read/write the same rows,
so rollback is a traffic switch, not a data migration:

1. Re-enable the Node worker (`WORKER_IN_PROCESS=true` / tick route) **after** removing the Laravel cron entry (never both).
2. Revert the Next.js deployment to the last Prisma-only build (or toggle the feature flag per feature if the switch is done gradually).
3. Point provider DLR / SSLCommerz IPN URLs back to the Next.js host if they were moved.
4. Sessions keep working (same table); API keys keep working (same pepper).
5. Only restore the database dump if data was corrupted — that loses everything since the dump.

## 28. Smoke tests

Run after deploy, against production, with a dedicated test organization (no real customers):

1. `GET /api/v1/health` → 200; `GET /api/v1/internal/ready` (Bearer) → 200, `scheduler: ok`.
2. Log in on Next (still Prisma) → copy the session cookie value → `GET /api/v1/auth/me` with it as Bearer → same user/org.
3. Customer API with a test key: `GET /balance`, `POST /sms/estimate`.
4. **Paid, authorised step:** `POST /sms/send` to your own number → SUBMITTED → DLR → DELIVERED; balance debited once.
5. A campaign of 2–3 own numbers; pause/resume; completion.
6. SSLCommerz sandbox (then live with the smallest amount, authorised): success, cancel, failure; wallet credited once.
7. Manual payment → admin approval → credit once.
8. Exports download through Next proxies.
9. Kill-switch test: set `SMS_PROVIDER=mock` temporarily → readiness 503, sends 503, nothing charged; revert.

---

## 29. Changes made during this audit

| Change | Files | Why |
|---|---|---|
| Mock SMS provider refused in production (before charge/claim/poll) | `SmsProviderManager`, `SendService`, `CampaignRunner`, `CampaignService`, `AuthService`, `DispatcherService` | Prevent charging for SMS that never leaves, and fake DELIVERED |
| Ambiguous provider outcomes never resent; in-flight marker + interrupted-send closer; connect timeout | `HttpSmsProvider`, `SendSmsResult`, `DispatcherService` | Prevent duplicate SMS |
| SSLCommerz amount mandatory; success without verified amount never credited | `SslCommerzProvider`, `PaymentCallbackService` | No credit without server-verified amount |
| Trusted client-IP forwarding (`X-SMSFlow-Client-IP` + `FRONTEND_PROXY_SECRET`) | `AssignRequestContext`, `config/smsflow.php`, `.env.example` | Per-IP login limits and audit IPs after cutover |
| Readiness expanded + worker heartbeat | `HealthController`, `WorkerService` | Detect mock/debug/no-cron/no-secret in production |
| `app/transactions/export` alias | `routes/api.php` | Same path as the Next route |
| `DELETE /app/contacts/{id}` → 404 for foreign/missing ids | `ContactController` | Consistent IDOR behaviour |
| Unused Laravel client | `src/lib/laravel-api.ts` | One reviewed client for the cutover |
| New tests (30) | `AuthCutoverTest`, `IdorSweepTest`, `ProductionSafeguardsTest`, `DuplicateSendTest`, `ClientIpForwardingTest`, `SslCommerzCallbackTest` | Evidence for this audit |

Test run: **205 passed, 2,510 assertions** (`php artisan test`, MariaDB 10.4), Pint clean.
Frontend: `tsc --noEmit` and ESLint clean; the client is not imported.

## 30. Go-live gate

| Gate item | State |
|---|---|
| Real SMS provider verified end-to-end | 🔴 RED |
| SSLCommerz sandbox + live verified (or disabled, manual only) | 🔴 RED (🟢 if launched manual-only) |
| Current backend deployed, DB reachable, `migrate --pretend` clean | 🔴 RED |
| Cron running, readiness 200 in production | 🔴 RED (not deployed) |
| Backup taken and restore tested | 🔴 RED |
| Frontend actions switched + export proxies | 🔴 RED (not started, by instruction) |
| Single worker (Node worker off) | 🟡 YELLOW (procedure defined) |
| Shared secrets identical | 🟡 YELLOW (compatible; values must be copied) |
| Client IP behind Cloudflare | 🟡 YELLOW |
| Uploads copied | 🟡 YELLOW |
| Alerting | 🟡 YELLOW |
| Auth compatibility | 🟢 GREEN |
| Tenant isolation / IDOR | 🟢 GREEN |
| Wallet ledger + concurrency | 🟢 GREEN |
| Duplicate-SMS protection | 🟢 GREEN |
| Mock safeguards | 🟢 GREEN |
| Customer API contract | 🟢 GREEN |
| Test suite | 🟢 GREEN |

All gate items must be GREEN. **Current: NO-GO.**

---

## Final output

1. **Readiness score: 62 / 100.** Code completeness and safety ≈ 90 %, but external verification (provider, payments, deployment, backups, frontend wiring) — which carries most of the go-live risk — is largely missing.
2. **GREEN:** auth/session compatibility, argon2/HMAC/AES cross-compatibility, tenant isolation (IDOR sweep), wallet ledger + concurrency, duplicate-SMS protection, mock safeguards, customer API contract, payment idempotency logic, 205 passing tests.
3. **YELLOW:** single-worker switchover, copying identical secrets, Cloudflare client IP / `TRUSTED_PROXIES`, upload copy, alerting, large-campaign memory, possible PII in DB error logs, unconfirmed-send refund trade-off, `proc_open` for `runInBackground`.
4. **RED:** real SMS provider unverified; SSLCommerz unverified; production backend outdated + DB unreachable; cron/readiness not running in production; backups/restore untested; frontend not connected (export proxies, 78 actions).
5. **Blockers:** the six RED items above.
6. **Files per blocker:** SMS → `backend/app/Services/Sms/Providers/HttpSmsProvider.php` (`interpretSendResponse`, `parseDeliveryWebhook`, `verified`); SSLCommerz → `backend/app/Services/Payment/Providers/SslCommerzProvider.php`; deployment → `backend/.env` (server), document root, `backend/routes/console.php`; backups → hosting panel (no repo file); frontend → `src/features/*/actions.ts` (12 files), `src/app/api/v1/app/**/route.ts` (5 export/document handlers), `src/lib/laravel-api.ts`.
7. **Config:** §14 (REQUIRED list) + `FRONTEND_PROXY_SECRET` on both servers + `LARAVEL_API_URL` + `WORKER_IN_PROCESS=false` at switch time.
8. **Hostinger commands:** §13.
9. **Cron:** `* * * * * cd /home/<user>/domains/<api-domain>/backend && /usr/bin/php artisan schedule:run >> /dev/null 2>&1`
10. **Queue config:** `QUEUE_CONNECTION=database`, `QUEUE_WORKER_VIA_SCHEDULER=true`, `CACHE_STORE=database`, `SESSION_DRIVER=array`; SMS does not depend on the Laravel queue.
11. **SMS provider status:** UNVERIFIED — REQUIRES REAL PROVIDER CREDENTIALS/DOCUMENTATION.
12. **SSLCommerz status:** UNVERIFIED (logic tested against faked validation API; sandbox never run).
13. **Auth compatibility status:** COMPATIBLE — verified by integration test and cross-language checks.
14. **Frontend migration status:** not started (by instruction); client ready, unused; 78 server actions + 5 browser-download routes to switch.
15. **Prisma dependency count:** 471 operations in 58 files / 219 functions (Appendix A).
16. **Cutover sequence:**
    1. Backup + restore drill (§26).
    2. Deploy current backend, fix DB access, `migrate --pretend` → `migrate`, caches, readiness (worker **off**: no cron yet).
    3. Verify the SMS provider adapter against docs; paid own-number tests on a staging copy or with the Node worker paused.
    4. SSLCommerz sandbox (or launch manual-only).
    5. Point customer API host (or proxy) to Laravel; provider DLR + IPN URLs to the API host.
    6. **Switch workers in one step:** disable Node worker → enable Laravel cron → confirm `scheduler: ok`.
    7. Switch Next.js features one at a time to `laravel-api.ts` (read pages first, then writes with `Idempotency-Key`; exports as proxies), smoke test each.
    8. When Prisma operations reach 0 for a week without rollback: remove Prisma.
17. **Rollback plan:** §27 — traffic/worker switch back; no schema change to undo; restore dump only for data corruption.
18. **GO / NO-GO: NO-GO.** Proceed with steps 1–4 of the cutover sequence; re-run this gate when the RED items have evidence.

---

## Appendix A — Prisma function inventory

Generated by scanning `src/` (excluding `src/generated/prisma`) for Prisma client calls, attributed
to the enclosing function. "MIGRATION REQUIRED": YES = rewrite to call the Laravel endpoint;
CAN BE DELETED AFTER CUTOVER = Laravel already serves this path directly.

**471 Prisma operations in 58 files / 219 functions** (application code; `src/generated/prisma` excluded).

| FILE | FUNCTION | PRISMA OPERATIONS | LARAVEL ENDPOINT | MIGRATION REQUIRED |
|---|---|---|---|---|
| `app/admin/layout.tsx` | `AdminLayout` | abuseReport.count, campaign.count, payment.count, senderId.count, supportTicket.count | /admin/* (page-level reads) | YES |
| `app/admin/abuse/page.tsx` | `AdminAbusePage` | abuseReport.findMany, blocklistEntry.findMany, contactRequest.findMany, organization.findMany | /admin/* (page-level reads) | YES |
| `app/admin/api-logs/page.tsx` | `AdminApiLogsPage` | apiLog.count, apiLog.findMany | /admin/* (page-level reads) | YES |
| `app/admin/audit-logs/page.tsx` | `AdminAuditPage` | auditLog.count, auditLog.findMany | /admin/* (page-level reads) | YES |
| `app/admin/customers/[id]/page.tsx` | `AdminCustomerPage` | pricingPlan.findMany | /admin/* (page-level reads) | YES |
| `app/admin/messages/page.tsx` | `AdminMessagesPage` | message.count, message.findMany | /admin/* (page-level reads) | YES |
| `app/admin/pricing/page.tsx` | `AdminPricingPage` | creditPackage.findMany, pricingPlan.findMany | /admin/* (page-level reads) | YES |
| `app/admin/wallets/page.tsx` | `AdminWalletsPage` | $queryRaw, wallet.aggregate, wallet.count, wallet.findMany | /admin/* (page-level reads) | YES |
| `app/api/health/route.ts` | `GET` | $queryRaw, message.count | Laravel routes (webhooks, cron, health) — Next route handlers removed after DNS switch | CAN BE DELETED AFTER CUTOVER |
| `app/api/v1/messages/route.ts` | `if` | message.findMany | Laravel routes (webhooks, cron, health) — Next route handlers removed after DNS switch | CAN BE DELETED AFTER CUTOVER |
| `app/api/v1/messages/[id]/route.ts` | `GET` | message.findFirst | Laravel routes (webhooks, cron, health) — Next route handlers removed after DNS switch | CAN BE DELETED AFTER CUTOVER |
| `app/api/v1/sender-ids/route.ts` | `GET` | senderId.findMany | Laravel routes (webhooks, cron, health) — Next route handlers removed after DNS switch | CAN BE DELETED AFTER CUTOVER |
| `app/dashboard/layout.tsx` | `DashboardLayout` | notification.count, organization.findUniqueOrThrow, organizationMember.findMany, wallet.findUnique | /app/dashboard, /app/* reads | YES |
| `app/dashboard/reports/page.tsx` | `ReportsPage` | campaign.findMany, message.findMany | /app/dashboard, /app/* reads | YES |
| `app/dashboard/send/page.tsx` | `SendPage` | template.findMany | /app/dashboard, /app/* reads | YES |
| `app/dashboard/send/page.tsx` | `if` | campaign.findFirst | /app/dashboard, /app/* reads | YES |
| `app/dashboard/settings/page.tsx` | `SettingsPage` | organization.findUniqueOrThrow, user.findUniqueOrThrow | /app/dashboard, /app/* reads | YES |
| `features/admin/config.ts` | `savePlan` | $transaction, pricingPlan.create, pricingPlan.findFirst, pricingPlan.findUnique, pricingPlan.update, pricingPlan.updateMany | /admin/* (AdminCustomers, AdminReview, AdminSettings, AdminReports…) | YES |
| `features/admin/config.ts` | `savePackage` | creditPackage.create, creditPackage.findUnique, creditPackage.update | /admin/* (AdminCustomers, AdminReview, AdminSettings, AdminReports…) | YES |
| `features/admin/config.ts` | `addBlocklist` | blocklistEntry.upsert | /admin/* (AdminCustomers, AdminReview, AdminSettings, AdminReports…) | YES |
| `features/admin/config.ts` | `removeBlocklist` | blocklistEntry.delete | /admin/* (AdminCustomers, AdminReview, AdminSettings, AdminReports…) | YES |
| `features/admin/overview.ts` | `getAdminOverview` | $queryRaw×2, abuseReport.count, apiLog.count, campaign.count, contactRequest.count, message.count×3, organization.count×2, payment.aggregate, payment.count, senderId.count, supportTicket.count, user.count×2 | /admin/* (AdminCustomers, AdminReview, AdminSettings, AdminReports…) | YES |
| `features/admin/service.ts` | `listOrganizations` | organization.count, organization.findMany | /admin/* (AdminCustomers, AdminReview, AdminSettings, AdminReports…) | YES |
| `features/admin/service.ts` | `getOrganizationDetail` | auditLog.findMany, message.count×2, organization.findFirst | /admin/* (AdminCustomers, AdminReview, AdminSettings, AdminReports…) | YES |
| `features/admin/service.ts` | `updateOrganizationControls` | organization.findFirst, organization.update | /admin/* (AdminCustomers, AdminReview, AdminSettings, AdminReports…) | YES |
| `features/admin/service.ts` | `setOrganizationStatus` | organization.findFirst, organization.update | /admin/* (AdminCustomers, AdminReview, AdminSettings, AdminReports…) | YES |
| `features/admin/service.ts` | `if` | campaign.updateMany, user.count, user.update | /admin/* (AdminCustomers, AdminReview, AdminSettings, AdminReports…) | YES |
| `features/admin/service.ts` | `adjustWallet` | $transaction | /admin/* (AdminCustomers, AdminReview, AdminSettings, AdminReports…) | YES |
| `features/admin/service.ts` | `listCampaignsForAdmin` | campaign.count, campaign.findMany | /admin/* (AdminCustomers, AdminReview, AdminSettings, AdminReports…) | YES |
| `features/admin/service.ts` | `reviewCampaign` | campaign.findFirst, campaign.update | /admin/* (AdminCustomers, AdminReview, AdminSettings, AdminReports…) | YES |
| `features/admin/service.ts` | `listSenderIdsForAdmin` | senderId.count, senderId.findMany | /admin/* (AdminCustomers, AdminReview, AdminSettings, AdminReports…) | YES |
| `features/admin/service.ts` | `reviewSenderId` | $transaction, senderId.count, senderId.findUnique, senderId.update | /admin/* (AdminCustomers, AdminReview, AdminSettings, AdminReports…) | YES |
| `features/admin/service.ts` | `listPaymentsForAdmin` | payment.count, payment.findMany | /admin/* (AdminCustomers, AdminReview, AdminSettings, AdminReports…) | YES |
| `features/admin/service.ts` | `reviewManualPayment` | payment.findUnique | /admin/* (AdminCustomers, AdminReview, AdminSettings, AdminReports…) | YES |
| `features/admin/service.ts` | `listTicketsForAdmin` | supportTicket.count, supportTicket.findMany | /admin/* (AdminCustomers, AdminReview, AdminSettings, AdminReports…) | YES |
| `features/admin/service.ts` | `getTicketForAdmin` | supportTicket.findUnique | /admin/* (AdminCustomers, AdminReview, AdminSettings, AdminReports…) | YES |
| `features/admin/service.ts` | `staffReply` | $transaction, supportMessage.create, supportTicket.findUnique, supportTicket.update | /admin/* (AdminCustomers, AdminReview, AdminSettings, AdminReports…) | YES |
| `features/admin/service.ts` | `setTicketStatus` | supportTicket.findUnique, supportTicket.update | /admin/* (AdminCustomers, AdminReview, AdminSettings, AdminReports…) | YES |
| `features/admin/service.ts` | `listUsers` | user.count, user.findMany | /admin/* (AdminCustomers, AdminReview, AdminSettings, AdminReports…) | YES |
| `features/admin/service.ts` | `updateUserAccess` | user.findUnique | /admin/* (AdminCustomers, AdminReview, AdminSettings, AdminReports…) | YES |
| `features/admin/service.ts` | `setAbuseStatus` | abuseReport.update | /admin/* (AdminCustomers, AdminReview, AdminSettings, AdminReports…) | YES |
| `features/admin/service.ts` | `setLeadStatus` | contactRequest.update | /admin/* (AdminCustomers, AdminReview, AdminSettings, AdminReports…) | YES |
| `features/auth/actions.ts` | `setLocaleAction` | user.update | /auth/* (login, register, logout, me, password, verify, otp) | YES (cookie still set by Next) |
| `features/auth/actions.ts` | `createOrganizationAction` | $transaction | /auth/* (login, register, logout, me, password, verify, otp) | YES (cookie still set by Next) |
| `features/auth/service.ts` | `registerAccount` | $transaction, user.create, user.findFirst | /auth/* (login, register, logout, me, password, verify, otp) | YES (cookie still set by Next) |
| `features/auth/service.ts` | `if` | user.findFirst, user.update×2 | /auth/* (login, register, logout, me, password, verify, otp) | YES (cookie still set by Next) |
| `features/auth/service.ts` | `issueEmailVerification` | user.findUniqueOrThrow, verificationToken.create, verificationToken.deleteMany | /auth/* (login, register, logout, me, password, verify, otp) | YES (cookie still set by Next) |
| `features/auth/service.ts` | `verifyEmailToken` | $transaction, user.update, verificationToken.findUnique, verificationToken.update | /auth/* (login, register, logout, me, password, verify, otp) | YES (cookie still set by Next) |
| `features/auth/service.ts` | `requestPasswordReset` | user.findFirst, verificationToken.create, verificationToken.deleteMany | /auth/* (login, register, logout, me, password, verify, otp) | YES (cookie still set by Next) |
| `features/auth/service.ts` | `resetPassword` | $transaction, user.update, verificationToken.findUnique, verificationToken.update | /auth/* (login, register, logout, me, password, verify, otp) | YES (cookie still set by Next) |
| `features/auth/service.ts` | `changePassword` | user.findUniqueOrThrow, user.update | /auth/* (login, register, logout, me, password, verify, otp) | YES (cookie still set by Next) |
| `features/auth/service.ts` | `sendPhoneOtp` | user.findUniqueOrThrow, verificationToken.create, verificationToken.deleteMany | /auth/* (login, register, logout, me, password, verify, otp) | YES (cookie still set by Next) |
| `features/auth/service.ts` | `verifyPhoneOtp` | $transaction, user.update, verificationToken.findFirst, verificationToken.update×2 | /auth/* (login, register, logout, me, password, verify, otp) | YES (cookie still set by Next) |
| `features/campaigns/actions.ts` | `launchInBackground` | message.findMany | /app/campaigns* | YES |
| `features/campaigns/service.ts` | `ownedGroups` | contactGroup.findMany | /app/campaigns* | YES |
| `features/campaigns/service.ts` | `loadEditable` | campaign.findFirst | /app/campaigns* | YES |
| `features/campaigns/service.ts` | `saveDraft` | campaign.create, campaign.update | /app/campaigns* | YES |
| `features/campaigns/service.ts` | `if` | organization.findUniqueOrThrow | /app/campaigns* | YES |
| `features/campaigns/service.ts` | `submitCampaign` | campaign.create, campaign.update | /app/campaigns* | YES |
| `features/campaigns/service.ts` | `getOwned` | campaign.findFirst | /app/campaigns* | YES |
| `features/campaigns/service.ts` | `pauseCampaign` | campaign.updateMany | /app/campaigns* | YES |
| `features/campaigns/service.ts` | `resumeCampaign` | campaign.updateMany | /app/campaigns* | YES |
| `features/campaigns/service.ts` | `cancelCampaign` | campaign.updateMany | /app/campaigns* | YES |
| `features/campaigns/service.ts` | `cancelQueuedMessages` | message.findMany | /app/campaigns* | YES |
| `features/campaigns/service.ts` | `for` | message.count | /app/campaigns* | YES |
| `features/campaigns/service.ts` | `duplicateCampaign` | campaign.create | /app/campaigns* | YES |
| `features/campaigns/service.ts` | `deleteDraft` | campaign.update | /app/campaigns* | YES |
| `features/campaigns/service.ts` | `listCampaigns` | campaign.count, campaign.findMany, campaign.groupBy | /app/campaigns* | YES |
| `features/campaigns/service.ts` | `getCampaignDetail` | $queryRaw×2, auditLog.findMany, campaign.findFirst, campaignRecipient.groupBy, message.groupBy, user.findUnique | /app/campaigns* | YES |
| `features/campaigns/service.ts` | `listCampaignMessages` | message.count, message.findMany | /app/campaigns* | YES |
| `features/campaigns/service.ts` | `exportCampaignReport` | campaignRecipient.findMany, message.findMany | /app/campaigns* | YES |
| `features/contacts/service.ts` | `listContacts` | contact.count, contact.findMany | /app/contacts*, /app/contact-groups*, /app/suppression* | YES |
| `features/contacts/service.ts` | `getContact` | contact.findFirst | /app/contacts*, /app/contact-groups*, /app/suppression* | YES |
| `features/contacts/service.ts` | `assertGroupsOwned` | contactGroup.count | /app/contacts*, /app/contact-groups*, /app/suppression* | YES |
| `features/contacts/service.ts` | `if` | $transaction×2, contact.create, contact.delete, contact.findUnique, contact.update×2, contactGroup.create, contactGroup.findFirst, contactGroup.update, contactGroupMember.createMany×2, contactGroupMember.deleteMany×2, suppressionEntry.upsert | /app/contacts*, /app/contact-groups*, /app/suppression* | YES |
| `features/contacts/service.ts` | `createContact` | contact.findUnique | /app/contacts*, /app/contact-groups*, /app/suppression* | YES |
| `features/contacts/service.ts` | `bulkContacts` | contact.findMany | /app/contacts*, /app/contact-groups*, /app/suppression* | YES |
| `features/contacts/service.ts` | `switch` | $executeRaw, contact.updateMany×2, contactGroupMember.createMany, contactGroupMember.deleteMany×2, suppressionEntry.createMany | /app/contacts*, /app/contact-groups*, /app/suppression* | YES |
| `features/contacts/service.ts` | `for` | $transaction, contact.createMany, contact.findMany×2, contact.update, contactGroupMember.createMany, suppressionEntry.createMany | /app/contacts*, /app/contact-groups*, /app/suppression* | YES |
| `features/contacts/service.ts` | `exportContactsCsv` | contact.findMany | /app/contacts*, /app/contact-groups*, /app/suppression* | YES |
| `features/contacts/service.ts` | `listGroups` | contactGroup.findMany | /app/contacts*, /app/contact-groups*, /app/suppression* | YES |
| `features/contacts/service.ts` | `saveGroup` | contactGroup.delete, contactGroup.findFirst | /app/contacts*, /app/contact-groups*, /app/suppression* | YES |
| `features/contacts/service.ts` | `deleteGroup` | $transaction, contactGroup.findFirst, contactGroup.update, contactGroupMember.deleteMany | /app/contacts*, /app/contact-groups*, /app/suppression* | YES |
| `features/contacts/service.ts` | `listSuppression` | suppressionEntry.count, suppressionEntry.findMany | /app/contacts*, /app/contact-groups*, /app/suppression* | YES |
| `features/contacts/service.ts` | `addSuppression` | contact.updateMany, suppressionEntry.upsert | /app/contacts*, /app/contact-groups*, /app/suppression* | YES |
| `features/contacts/service.ts` | `removeSuppression` | suppressionEntry.delete, suppressionEntry.findFirst | /app/contacts*, /app/contact-groups*, /app/suppression* | YES |
| `features/contacts/service.ts` | `allTags` | $queryRaw | /app/contacts*, /app/contact-groups*, /app/suppression* | YES |
| `features/developers/service.ts` | `listApiKeys` | apiKey.findMany | /app/api-keys*, /app/webhooks* | YES |
| `features/developers/service.ts` | `createApiKey` | apiKey.count, apiKey.create | /app/api-keys*, /app/webhooks* | YES |
| `features/developers/service.ts` | `revokeApiKey` | apiKey.findFirst, apiKey.update | /app/api-keys*, /app/webhooks* | YES |
| `features/developers/service.ts` | `listApiLogs` | apiLog.count, apiLog.findMany, apiLog.groupBy | /app/api-keys*, /app/webhooks* | YES |
| `features/developers/service.ts` | `listWebhooks` | webhookEndpoint.findMany | /app/api-keys*, /app/webhooks* | YES |
| `features/developers/service.ts` | `createWebhook` | webhookEndpoint.count, webhookEndpoint.create | /app/api-keys*, /app/webhooks* | YES |
| `features/developers/service.ts` | `ownWebhook` | webhookEndpoint.findFirst | /app/api-keys*, /app/webhooks* | YES |
| `features/developers/service.ts` | `toggleWebhook` | webhookEndpoint.update | /app/api-keys*, /app/webhooks* | YES |
| `features/developers/service.ts` | `deleteWebhook` | webhookEndpoint.delete | /app/api-keys*, /app/webhooks* | YES |
| `features/developers/service.ts` | `sendTestWebhook` | webhookDelivery.create | /app/api-keys*, /app/webhooks* | YES |
| `features/organizations/provision.ts` | `ensurePermissionCatalogue` | permission.upsert | /app/organizations*, /auth/switch-organization | YES |
| `features/organizations/provision.ts` | `createRolesForOrganization` | permission.findMany | /app/organizations*, /auth/switch-organization | YES |
| `features/organizations/provision.ts` | `for` | role.create | /app/organizations*, /auth/switch-organization | YES |
| `features/organizations/provision.ts` | `createOrganizationWithOwner` | organization.create, organizationMember.create, wallet.create | /app/organizations*, /auth/switch-organization | YES |
| `features/public/actions.ts` | `submitContactRequest` | contactRequest.create | /public/* | YES |
| `features/public/actions.ts` | `submitAbuseReport` | abuseReport.create, senderId.findFirst | /public/* | YES |
| `features/reports/messages.ts` | `listMessages` | message.count, message.findMany | /app/reports/* | YES |
| `features/reports/messages.ts` | `getMessage` | message.findFirst | /app/reports/* | YES |
| `features/reports/messages.ts` | `exportMessagesCsv` | message.findMany | /app/reports/* | YES |
| `features/reports/queries.ts` | `getStatusTotals` | $queryRaw | /app/reports/* | YES |
| `features/reports/queries.ts` | `getDailySeries` | $queryRaw | /app/reports/* | YES |
| `features/reports/queries.ts` | `getSpend` | walletTransaction.groupBy | /app/reports/* | YES |
| `features/reports/queries.ts` | `getOperatorBreakdown` | $queryRaw | /app/reports/* | YES |
| `features/reports/queries.ts` | `getFailureReasons` | $queryRaw | /app/reports/* | YES |
| `features/reports/queries.ts` | `getBalanceSummary` | wallet.findUnique | /app/reports/* | YES |
| `features/reports/queries.ts` | `getRecentCampaigns` | campaign.findMany | /app/reports/* | YES |
| `features/reports/queries.ts` | `getCampaignPerformance` | campaign.findMany | /app/reports/* | YES |
| `features/reports/queries.ts` | `getRecentTransactions` | walletTransaction.findMany | /app/reports/* | YES |
| `features/sender-ids/service.ts` | `listSenderIds` | senderId.findMany | /app/sender-ids* | YES |
| `features/sender-ids/service.ts` | `approvedSenderIds` | senderId.findMany | /app/sender-ids* | YES |
| `features/sender-ids/service.ts` | `requestSenderId` | senderId.findUnique | /app/sender-ids* | YES |
| `features/sender-ids/service.ts` | `if` | senderId.count, senderId.create, senderId.update | /app/sender-ids* | YES |
| `features/sender-ids/service.ts` | `setDefaultSenderId` | $transaction, senderId.findFirst, senderId.update, senderId.updateMany | /app/sender-ids* | YES |
| `features/sender-ids/service.ts` | `withdrawSenderIdRequest` | senderId.delete, senderId.findFirst | /app/sender-ids* | YES |
| `features/sender-ids/service.ts` | `getSenderIdDocument` | senderId.findFirst | /app/sender-ids* | YES |
| `features/settings/service.ts` | `updateProfile` | user.findUniqueOrThrow | /app/account*, /app/organization* | YES |
| `features/settings/service.ts` | `if` | organizationMember.count, organizationMember.delete, user.findFirst, user.update | /app/account*, /app/organization* | YES |
| `features/settings/service.ts` | `updateOrganization` | organization.update | /app/account*, /app/organization* | YES |
| `features/settings/service.ts` | `listSessions` | session.findMany | /app/account*, /app/organization* | YES |
| `features/settings/service.ts` | `revokeOwnSession` | session.findFirst | /app/account*, /app/organization* | YES |
| `features/settings/service.ts` | `getNotificationPrefs` | notificationPreference.findMany | /app/account*, /app/organization* | YES |
| `features/settings/service.ts` | `saveNotificationPrefs` | $transaction, notificationPreference.upsert | /app/account*, /app/organization* | YES |
| `features/settings/service.ts` | `listNotifications` | notification.count×2, notification.findMany | /app/account*, /app/organization* | YES |
| `features/settings/service.ts` | `markNotificationsRead` | notification.updateMany | /app/account*, /app/organization* | YES |
| `features/support/service.ts` | `listTickets` | supportTicket.count, supportTicket.findMany | /app/support/* | YES |
| `features/support/service.ts` | `createTicket` | supportTicket.count, supportTicket.create | /app/support/* | YES |
| `features/support/service.ts` | `getTicket` | supportTicket.findFirst | /app/support/* | YES |
| `features/support/service.ts` | `replyToTicket` | $transaction, supportMessage.create, supportTicket.findFirst, supportTicket.update | /app/support/* | YES |
| `features/support/service.ts` | `closeTicket` | supportTicket.updateMany | /app/support/* | YES |
| `features/team/service.ts` | `listTeam` | invitation.findMany, organizationMember.findMany, role.findMany | /app/team/* | YES |
| `features/team/service.ts` | `inviteMember` | invitation.count, invitation.create, invitation.updateMany, organization.findUniqueOrThrow, organizationMember.findFirst, role.findUniqueOrThrow, user.findUniqueOrThrow | /app/team/* | YES |
| `features/team/service.ts` | `revokeInvitation` | invitation.updateMany | /app/team/* | YES |
| `features/team/service.ts` | `ownersCount` | organizationMember.count | /app/team/* | YES |
| `features/team/service.ts` | `changeMemberRole` | organizationMember.findFirst, organizationMember.update, role.findUniqueOrThrow | /app/team/* | YES |
| `features/team/service.ts` | `setMemberStatus` | organizationMember.delete, organizationMember.findFirst, organizationMember.update | /app/team/* | YES |
| `features/team/service.ts` | `updateRolePermissions` | $transaction, permission.findMany, role.findUniqueOrThrow, rolePermission.createMany, rolePermission.deleteMany | /app/team/* | YES |
| `features/team/service.ts` | `findInvitation` | invitation.findUnique | /app/team/* | YES |
| `features/team/service.ts` | `acceptInvitation` | $transaction, invitation.updateMany, organizationMember.upsert, user.findUniqueOrThrow, user.update | /app/team/* | YES |
| `features/team/service.ts` | `createUserForInvitation` | user.create, user.findUnique×2 | /app/team/* | YES |
| `features/templates/service.ts` | `listTemplates` | template.findMany | /app/templates* | YES |
| `features/templates/service.ts` | `if` | template.count, template.create, template.findFirst, template.update | /app/templates* | YES |
| `features/templates/service.ts` | `deleteTemplate` | template.findFirst, template.update | /app/templates* | YES |
| `features/wallet/actions.ts` | `mockCheckoutAction` | payment.findUnique | /app/wallet*, /app/payments*, /app/transactions/export | YES |
| `features/wallet/service.ts` | `if` | creditPackage.findFirst | /app/wallet*, /app/payments*, /app/transactions/export | YES |
| `features/wallet/service.ts` | `createTopUp` | organization.findUniqueOrThrow, payment.count, payment.create, payment.update | /app/wallet*, /app/payments*, /app/transactions/export | YES |
| `features/wallet/service.ts` | `getOwnPayment` | payment.findFirst | /app/wallet*, /app/payments*, /app/transactions/export | YES |
| `features/wallet/service.ts` | `submitManualReference` | payment.updateMany | /app/wallet*, /app/payments*, /app/transactions/export | YES |
| `features/wallet/service.ts` | `cancelPendingPayment` | payment.updateMany | /app/wallet*, /app/payments*, /app/transactions/export | YES |
| `features/wallet/service.ts` | `listPayments` | payment.findMany | /app/wallet*, /app/payments*, /app/transactions/export | YES |
| `features/wallet/service.ts` | `listInvoices` | invoice.findMany | /app/wallet*, /app/payments*, /app/transactions/export | YES |
| `features/wallet/service.ts` | `getInvoice` | invoice.findFirst | /app/wallet*, /app/payments*, /app/transactions/export | YES |
| `features/wallet/service.ts` | `listTransactions` | walletTransaction.count, walletTransaction.findMany, walletTransaction.groupBy | /app/wallet*, /app/payments*, /app/transactions/export | YES |
| `features/wallet/service.ts` | `exportTransactionsCsv` | walletTransaction.findMany | /app/wallet*, /app/payments*, /app/transactions/export | YES |
| `features/wallet/service.ts` | `updateLowBalanceThreshold` | wallet.update | /app/wallet*, /app/payments*, /app/transactions/export | YES |
| `lib/audit.ts` | `audit` | auditLog.create | Laravel AuditLogger | CAN BE DELETED AFTER CUTOVER |
| `lib/rate-limit.ts` | `rateLimit` | $executeRaw, $queryRaw, $transaction | Laravel RateLimit middleware | CAN BE DELETED AFTER CUTOVER |
| `lib/rate-limit.ts` | `purgeExpiredRateLimits` | rateLimitBucket.deleteMany | Laravel RateLimit middleware | CAN BE DELETED AFTER CUTOVER |
| `lib/api/api-keys.ts` | `authenticateApiKey` | apiKey.findUnique, apiKey.update | Customer API is served by Laravel (/sms/*, /messages, /balance, /sender-ids) | CAN BE DELETED AFTER CUTOVER |
| `lib/api/handler.ts` | `fn` | apiLog.create, idempotencyKey.create, idempotencyKey.delete×2, idempotencyKey.findUnique, idempotencyKey.update | Customer API is served by Laravel (/sms/*, /messages, /balance, /sender-ids) | CAN BE DELETED AFTER CUTOVER |
| `lib/auth/session-store.ts` | `createSession` | session.create | AuthenticateSession / ResolveTenant middleware | YES (session resolution moves to /auth/me) |
| `lib/auth/session-store.ts` | `resolveSessionToken` | session.delete, session.findUnique | AuthenticateSession / ResolveTenant middleware | YES (session resolution moves to /auth/me) |
| `lib/auth/session-store.ts` | `if` | session.delete, session.update | AuthenticateSession / ResolveTenant middleware | YES (session resolution moves to /auth/me) |
| `lib/auth/session-store.ts` | `revokeSession` | session.deleteMany | AuthenticateSession / ResolveTenant middleware | YES (session resolution moves to /auth/me) |
| `lib/auth/session-store.ts` | `revokeAllUserSessions` | session.deleteMany | AuthenticateSession / ResolveTenant middleware | YES (session resolution moves to /auth/me) |
| `lib/auth/session-store.ts` | `buildTenantContext` | organizationMember.findUnique | AuthenticateSession / ResolveTenant middleware | YES (session resolution moves to /auth/me) |
| `lib/auth/session-store.ts` | `defaultOrganizationFor` | organizationMember.findFirst | AuthenticateSession / ResolveTenant middleware | YES (session resolution moves to /auth/me) |
| `lib/auth/session.ts` | `if` | session.update | AuthenticateSession / ResolveTenant middleware | YES (session resolution moves to /auth/me) |
| `lib/auth/session.ts` | `switchOrganization` | session.update | AuthenticateSession / ResolveTenant middleware | YES (session resolution moves to /auth/me) |
| `services/notify.ts` | `recipientsFor` | organizationMember.findMany | Laravel NotificationService | YES |
| `services/notify.ts` | `notify` | notification.createMany, notificationPreference.findMany, user.findMany | Laravel NotificationService | YES |
| `services/settings.ts` | `readRaw` | setting.findUnique | /admin/settings/* + /public/* | YES |
| `services/settings.ts` | `setSetting` | setting.upsert | /admin/settings/* + /public/* | YES |
| `services/settings.ts` | `if` | setting.deleteMany, setting.upsert | /admin/settings/* + /public/* | YES |
| `services/settings.ts` | `getSecretSetting` | setting.findUnique | /admin/settings/* + /public/* | YES |
| `services/settings.ts` | `listSecretStatus` | setting.findMany | /admin/settings/* + /public/* | YES |
| `services/billing/counters.ts` | `nextCounterValue` | $executeRaw, $queryRaw | /app/wallet*, /app/payments* (PaymentService, WalletService) | YES |
| `services/billing/payments.ts` | `completePayment` | $transaction, invoice.create, payment.findUnique, payment.findUniqueOrThrow, payment.updateMany | /app/wallet*, /app/payments* (PaymentService, WalletService) | YES |
| `services/billing/payments.ts` | `failPayment` | payment.findUniqueOrThrow, payment.updateMany | /app/wallet*, /app/payments* (PaymentService, WalletService) | YES |
| `services/billing/pricing.ts` | `getPublicPlans` | pricingPlan.findMany | /app/wallet*, /app/payments* (PaymentService, WalletService) | YES |
| `services/billing/pricing.ts` | `getActivePackages` | creditPackage.findMany | /app/wallet*, /app/payments* (PaymentService, WalletService) | YES |
| `services/billing/pricing.ts` | `getOrganizationPlan` | organization.findUnique, pricingPlan.findFirst×2 | /app/wallet*, /app/payments* (PaymentService, WalletService) | YES |
| `services/billing/wallet.ts` | `ensureWallet` | wallet.upsert | /app/wallet*, /app/payments* (PaymentService, WalletService) | YES |
| `services/billing/wallet.ts` | `readWalletRow` | $queryRaw | /app/wallet*, /app/payments* (PaymentService, WalletService) | YES |
| `services/billing/wallet.ts` | `debitWallet` | $executeRaw | /app/wallet*, /app/payments* (PaymentService, WalletService) | YES |
| `services/billing/wallet.ts` | `if` | walletTransaction.create | /app/wallet*, /app/payments* (PaymentService, WalletService) | YES |
| `services/billing/wallet.ts` | `creditWallet` | $executeRaw, walletTransaction.create | /app/wallet*, /app/payments* (PaymentService, WalletService) | YES |
| `services/billing/wallet.ts` | `getBalance` | wallet.findUnique | /app/wallet*, /app/payments* (PaymentService, WalletService) | YES |
| `services/messaging/campaign-runner.ts` | `if` | contact.findMany | Laravel services (SendService, DispatcherService, CampaignRunner, WorkerService) + /sms/*, /app/messages | YES — becomes Laravel-only; Node worker must stop |
| `services/messaging/campaign-runner.ts` | `launchCampaign` | $transaction, campaign.findUniqueOrThrow, campaign.update×2, campaign.updateMany, campaignRecipient.createMany, message.createMany, organization.findUniqueOrThrow, senderId.findFirst | Laravel services (SendService, DispatcherService, CampaignRunner, WorkerService) + /sms/*, /app/messages | YES — becomes Laravel-only; Node worker must stop |
| `services/messaging/campaign-runner.ts` | `launchDueCampaigns` | campaign.findMany | Laravel services (SendService, DispatcherService, CampaignRunner, WorkerService) + /sms/*, /app/messages | YES — becomes Laravel-only; Node worker must stop |
| `services/messaging/campaign-runner.ts` | `finalizeCampaigns` | campaign.findMany | Laravel services (SendService, DispatcherService, CampaignRunner, WorkerService) + /sms/*, /app/messages | YES — becomes Laravel-only; Node worker must stop |
| `services/messaging/campaign-runner.ts` | `for` | campaign.findUniqueOrThrow, campaign.updateMany, message.count | Laravel services (SendService, DispatcherService, CampaignRunner, WorkerService) + /sms/*, /app/messages | YES — becomes Laravel-only; Node worker must stop |
| `services/messaging/compliance.ts` | `assertContentAllowed` | blocklistEntry.findMany | Laravel services (SendService, DispatcherService, CampaignRunner, WorkerService) + /sms/*, /app/messages | YES — becomes Laravel-only; Node worker must stop |
| `services/messaging/compliance.ts` | `blockedNumbers` | blocklistEntry.findMany | Laravel services (SendService, DispatcherService, CampaignRunner, WorkerService) + /sms/*, /app/messages | YES — becomes Laravel-only; Node worker must stop |
| `services/messaging/compliance.ts` | `for` | suppressionEntry.findMany | Laravel services (SendService, DispatcherService, CampaignRunner, WorkerService) + /sms/*, /app/messages | YES — becomes Laravel-only; Node worker must stop |
| `services/messaging/compliance.ts` | `assertWithinSendingLimits` | message.count×2, organization.findUniqueOrThrow | Laravel services (SendService, DispatcherService, CampaignRunner, WorkerService) + /sms/*, /app/messages | YES — becomes Laravel-only; Node worker must stop |
| `services/messaging/compliance.ts` | `lockWallet` | $queryRaw | Laravel services (SendService, DispatcherService, CampaignRunner, WorkerService) + /sms/*, /app/messages | YES — becomes Laravel-only; Node worker must stop |
| `services/messaging/delivery.ts` | `applyStatusUpdate` | $queryRaw, $transaction, campaign.update, message.update×2, messageEvent.createMany | Laravel services (SendService, DispatcherService, CampaignRunner, WorkerService) + /sms/*, /app/messages | YES — becomes Laravel-only; Node worker must stop |
| `services/messaging/delivery.ts` | `findMessageByProviderId` | message.findUnique | Laravel services (SendService, DispatcherService, CampaignRunner, WorkerService) + /sms/*, /app/messages | YES — becomes Laravel-only; Node worker must stop |
| `services/messaging/dispatcher.ts` | `for` | $queryRaw, message.update×2 | Laravel services (SendService, DispatcherService, CampaignRunner, WorkerService) + /sms/*, /app/messages | YES — becomes Laravel-only; Node worker must stop |
| `services/messaging/dispatcher.ts` | `leaseMessages` | $executeRaw, $queryRaw, $transaction | Laravel services (SendService, DispatcherService, CampaignRunner, WorkerService) + /sms/*, /app/messages | YES — becomes Laravel-only; Node worker must stop |
| `services/messaging/dispatcher.ts` | `dispatchMessages` | message.findMany | Laravel services (SendService, DispatcherService, CampaignRunner, WorkerService) + /sms/*, /app/messages | YES — becomes Laravel-only; Node worker must stop |
| `services/messaging/dispatcher.ts` | `pollDeliveryStatuses` | message.findMany | Laravel services (SendService, DispatcherService, CampaignRunner, WorkerService) + /sms/*, /app/messages | YES — becomes Laravel-only; Node worker must stop |
| `services/messaging/inbound.ts` | `for` | contact.updateMany, inboundWebhookEvent.create×2, inboundWebhookEvent.update×5, message.findMany, suppressionEntry.upsert | Laravel services (SendService, DispatcherService, CampaignRunner, WorkerService) + /sms/*, /app/messages | YES — becomes Laravel-only; Node worker must stop |
| `services/messaging/low-balance.ts` | `checkLowBalance` | $executeRaw, $queryRaw | Laravel services (SendService, DispatcherService, CampaignRunner, WorkerService) + /sms/*, /app/messages | YES — becomes Laravel-only; Node worker must stop |
| `services/messaging/outbound-webhooks.ts` | `enqueueWebhookEvent` | webhookDelivery.createMany, webhookEndpoint.findMany | Laravel services (SendService, DispatcherService, CampaignRunner, WorkerService) + /sms/*, /app/messages | YES — becomes Laravel-only; Node worker must stop |
| `services/messaging/outbound-webhooks.ts` | `deliverPendingWebhooks` | webhookDelivery.findMany | Laravel services (SendService, DispatcherService, CampaignRunner, WorkerService) + /sms/*, /app/messages | YES — becomes Laravel-only; Node worker must stop |
| `services/messaging/outbound-webhooks.ts` | `for` | webhookDelivery.update×2, webhookDelivery.updateMany, webhookEndpoint.update | Laravel services (SendService, DispatcherService, CampaignRunner, WorkerService) + /sms/*, /app/messages | YES — becomes Laravel-only; Node worker must stop |
| `services/messaging/send.ts` | `if` | $transaction, message.createMany, organization.findUniqueOrThrow, senderId.findFirst×2 | Laravel services (SendService, DispatcherService, CampaignRunner, WorkerService) + /sms/*, /app/messages | YES — becomes Laravel-only; Node worker must stop |
| `services/messaging/worker.ts` | `cancelLeftoverMessages` | message.findMany | Laravel services (SendService, DispatcherService, CampaignRunner, WorkerService) + /sms/*, /app/messages | YES — becomes Laravel-only; Node worker must stop |
| `services/messaging/worker.ts` | `runHousekeeping` | idempotencyKey.deleteMany, payment.updateMany, session.deleteMany, verificationToken.deleteMany | Laravel services (SendService, DispatcherService, CampaignRunner, WorkerService) + /sms/*, /app/messages | YES — becomes Laravel-only; Node worker must stop |
| `services/payments/callbacks.ts` | `processPaymentCallback` | payment.findUnique | /webhooks/payments/*, /payments/*/return | CAN BE DELETED AFTER CUTOVER |
