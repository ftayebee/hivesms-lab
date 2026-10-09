# 16 · Production cutover runbook (Next.js → Laravel)

Date: 2026-10-09. Follows [14](14-frontend-laravel-cutover-audit.md) and [15](15-prisma-removal-readiness.md).
**Status: no production flag has been changed.** This document is the plan; each stage needs explicit approval.

## 1. Verification done for this runbook (local only)

All runs used local MariaDB 10.4 (XAMPP) and local Laravel with `SMS_PROVIDER=mock`,
`PAYMENT_PROVIDERS=mock,manual`, `MAIL_MAILER=log`. No production write, no real SMS, no real payment.

| Suite | Target | Result |
|---|---|---|
| Prisma integration (`--project integration`) | `smsflow_test` | **50 passed** (6 files) after the fixes in § 1.1 |
| Laravel cutover (`--project laravel`) | Laravel :8001 → `smsflow_cutover`, with a test-only `SMS_PROVIDER_WEBHOOK_SECRET` | **36 passed** (10 existing + 26 new) |
| Laravel feature tests touched by this pass | `smsflow_api_test` | composer + manual-payment tests: 2 passed (27 assertions) |

Production was probed **read-only and unauthenticated** only:

| Probe | Answer | Meaning |
|---|---|---|
| `GET /api/v1/health` | 200 | API reachable at `https://smsbackend.hivelabsbd.com/api/v1` |
| `GET /api/v1/internal/ready` (no token) | 401 | needs `Authorization: Bearer <CRON_SECRET>` |
| `GET /api/v1/app/sms/composer` (no token) | **404** | new backend code **not deployed** (deployed → 401) |
| `GET /api/v1/admin/settings/billing-policy` (no token) | **405** | new GET route **not deployed** (deployed → 401) |
| `GET /api/v1/public/pricing` | no `maximumTopUp` key | new fields **not deployed** |

### 1.1 Prisma integration suite

Run with `TEST_DATABASE_URL=mysql://root@127.0.0.1:3306/smsflow_test` (the `.env` value used a `smsflow`
user that does not exist locally → P1000 before any test ran). Both failures were **environment, not regressions**
(no code on their paths changed; Prisma bodies are untouched):

| Run | Result | Failures |
|---|---|---|
| 1 (other suites hitting the same MariaDB) | 48 / 50 | `api.test.ts › provider delivery webhook`; `mysql-portability › claims and delivery updates concurrently` |
| 2 (isolated) | 48 / 50 | webhook test again; `messaging › skips suppressed numbers` (transient: `role` null in `createRolesForOrganization` after a 55 s test — the 5 s interactive transaction expired on the slow local DB; passed in all other runs) |
| 3 (isolated, webhook fix) | 49 / 50 | portability test again |
| 4 (isolated, both fixes) | **50 / 50** | — |

1. **Webhook signature test** — `expected 200 to be 401` for a forged signature. The test signs with
   `process.env.SMS_PROVIDER_WEBHOOK_SECRET`, inherited from the developer `.env`, where it is empty; without a
   secret the mock provider accepts unsigned webhooks outside production (intended). Fix: the integration project
   pins a test-only secret in `vitest.config.mts`.
2. **Concurrency test** — 15 of 66 concurrent operations failed with `P2028 Unable to start a transaction in the
   given time` (pool wait > 2 s), not deadlocks. The local `.env` sets `DATABASE_POOL_SIZE=5`. Fix: the integration
   project pins the app default `10`; then 3/3 isolated runs of the file and the full suite passed.
   Production note: the Prisma path has the same sensitivity under bursts if the pool is small — another reason
   to move `worker` to Laravel and not shrink the pool.

### 1.2 New tests

`tests/laravel/proxy-routes.test.ts` (11) — calls the **real Next.js route handlers** with a `NextRequest`
(`LARAVEL_FEATURES=all`), so the BFF proxy layer itself is exercised against local Laravel:

- customer API: balance, estimate, send (202) with `Idempotency-Key` replay returning the same message,
  bulk, messages list/detail, sender IDs;
- errors pass through unchanged: 422 validation, 401 missing/invalid key; **the session cookie is not
  forwarded on public API routes** and a session token is not accepted as an API key;
- tenant isolation: org B's key gets 404 for org A's message and never lists it;
- delivery webhook: raw body + `x-signature` HMAC reach Laravel byte-for-byte → message `DELIVERED`;
  replay acknowledged; **tampered body and unsigned request → 401**; unknown provider → 404;
- inbound `STOP` → number suppressed for the organization that messaged it;
- payment IPN and browser return (GET + form POST): forged "success" **never credits** the wallet, payment
  stays `PENDING`; return answers `303` to `<FRONTEND_URL>/dashboard/wallet…`.

`tests/laravel/feature-modules.test.ts` (15) — the service functions pages/actions call, with the session
cookie simulated through `next/headers`:

- templates: create/search/update/delete, 422 mapping, cross-tenant 404 (update, delete) and no listing;
- team: list owner/roles, invite + revoke, last owner cannot demote/disable self, cross-tenant 404s;
- support: create/list/reply/close, no internal notes, cross-tenant 404 (read, reply, close), 422;
- settings: profile + organization update (always the session's user/org), 422, session list and revoke
  (other user cannot revoke), notification preferences round-trip, sole owner cannot leave;
- notifications: list after a mock top-up, mark one / all read, other org's mark-read has no effect.

Shared helpers: `tests/support/laravel-helpers.ts`. The `laravel` project got `hookTimeout: 120_000`.

Command (local only; the setup refuses non-local URLs):

```bash
LARAVEL_TEST_API_URL=http://127.0.0.1:8001 LARAVEL_TEST_DATABASE_URL=mysql://root@127.0.0.1:3306/smsflow_cutover LARAVEL_TEST_PROXY_SECRET=<backend FRONTEND_PROXY_SECRET> LARAVEL_TEST_SMS_WEBHOOK_SECRET=<backend SMS_PROVIDER_WEBHOOK_SECRET> npx vitest run --project laravel
```

## 2. Backend changes that require a Laravel redeploy

All uncommitted in `backend/` (14 files: 9 source, 4 tests, routes). No migration, no schema or data change.

| Change | Route / file | AuthN / AuthZ | Tenant scope | Input validation | Tests |
|---|---|---|---|---|---|
| **NEW** `GET /app/sms/composer` | CampaignController::composer, routes/api.php | session + `tenant:campaigns:write` | org from session only (no org parameter is read) | no input | CampaignTest: values, VIEWER 403, anon 401, **other org sees its own balance even with `?organizationId=`** (new) |
| **NEW** `GET /admin/settings/billing-policy` | AdminSettingsController::billingPolicy | `auth.session` + `platform:admin:pricing:manage` | platform-global | no input | AdminTest: ADMIN 200, SUPPORT 403 |
| `/app/payments/methods` + `policy` | PaymentController::methods | `tenant:billing:read` | global policy only | no input | PaymentTest |
| `/app/payments/{id}` + `meta.manualInstructions` (manual only) | PaymentController::show | `tenant:billing:read` | query `where organizationId` | uuid route pattern | PaymentTest: present for owner; **other org → 404, no meta** (new) |
| `/public/pricing` + `maximumTopUp`, `balanceValidityMonths` | PublicController | public | global | — | DashboardModulesTest |
| `/admin/overview` + `smsProvider` (key only, no secrets) | AdminPlatformController | `platform:admin:access` | platform | — | AdminTest |
| `/admin/api-logs` permission `admin:audit:read` → **`admin:messages:read`** | routes/api.php | **broadens access to SUPPORT** (same as the Next.js admin page) | platform | — | AdminTest |
| `/admin/messages` `provider` filter (matches `providerMessageId`), recipient search audited (`admin.messages.search`, first 20 chars) | AdminPlatformController, AdminService | `platform:admin:messages:read` | platform | `provider` nullable string ≤191 | AdminTest |
| `providerMessageId` in MessageResource only for platform staff | MessageResource | `RequestContext::ADMIN` | — | — | AdminTest: absent in `/app/reports/messages` |
| audit logs include `organization {id,name}` | AuditLogResource, AdminService | `platform:admin:audit:read` | platform | — | AdminTest |
| abuse reports `NEW` first | AdminService | unchanged | platform | — | relies on MySQL ENUM order (NEW is the 1st value in Prisma's `AbuseReportStatus`) |
| `CampaignResource.organization.createdAt` when selected | CampaignResource | unchanged | — | — | AdminTest |

Security note for approval: the `api-logs` change lets **SUPPORT** staff read customer API logs in Laravel,
which the Next.js admin page already allowed. Confirm this is intended before deploying.

## 3. Production configuration

Never `NEXT_PUBLIC_*`: every value below is server-only. Do not commit `.env` files.

### 3.1 Must be identical in both apps

| Next.js | Laravel | Why |
|---|---|---|
| `DATABASE_URL` (host/db/user) | `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD` | one database; sessions, wallets, documents metadata are shared |
| `AUTH_SECRET` (≥32) | `AUTH_SECRET` | HMAC of phone OTP codes — an OTP sent by one app must verify in the other |
| `API_KEY_PEPPER` (≥32) | `API_KEY_PEPPER` | API key hashes — every existing customer key breaks under `publicApi` if different |
| `SETTINGS_ENCRYPTION_KEY` (≥32) | `SETTINGS_ENCRYPTION_KEY` | encrypted provider/payment secrets in the `settings` table |
| `FRONTEND_PROXY_SECRET` (≥32) | `FRONTEND_PROXY_SECRET` | Laravel trusts the forwarded browser IP only with it; otherwise every user shares the Next.js IP for login/register limits |
| `APP_URL` (e.g. `https://<frontend>`) | `FRONTEND_URL` (first entry) | links in Laravel e-mails, payment-return redirect, CORS origin |
| `SMS_PROVIDER`, `SMS_PROVIDER_URL`, `SMS_PROVIDER_API_KEY`, `SMS_PROVIDER_API_SECRET`, `SMS_PROVIDER_WEBHOOK_SECRET`, `SMS_DEFAULT_SENDER_ID` | same names | both apps send/verify during the transition (DB settings override env in both) |
| `PAYMENT_PROVIDERS`, `PAYMENT_PROVIDER_KEY`, `PAYMENT_PROVIDER_SECRET`, `PAYMENT_PROVIDER_LIVE` | same names | keep `PAYMENT_PROVIDERS=manual` for the cutover |
| `ALLOW_MOCK_PAYMENTS` unset/false | `ALLOW_MOCK_PAYMENTS=false` | `/internal/ready` fails in production otherwise |
| `FEATURE_REGISTRATION_OPEN`, `FEATURE_PHONE_VERIFICATION` | same names | same behaviour on either path |
| `CRON_SECRET` (≥16) | `CRON_SECRET` | not strictly shared, but Next's tick route and Laravel's `/internal/ready` + worker tick both use it; keep one value |

### 3.2 Next.js only

`LARAVEL_API_URL=https://smsbackend.hivelabsbd.com/api/v1` (origin, `/api` or `/api/v1` all normalise to
`…/api/v1`; unit-tested), optional `LARAVEL_API_TIMEOUT_MS` (default 15000; proxies 30000),
`LARAVEL_FEATURES` (§ 4), plus everything Prisma mode already needs (`DATABASE_URL`, `DATABASE_POOL_SIZE`,
`EMAIL_*`, `STORAGE_*`/`LOCAL_DATA_DIR`, `LOG_LEVEL`, `WORKER_*`) — Prisma stays the rollback path.

### 3.3 Laravel only

`APP_ENV=production`, `APP_DEBUG=false`, `APP_KEY`, `APP_URL=https://smsbackend.hivelabsbd.com`,
`TRUSTED_PROXIES` (Hostinger front proxy), `MAIL_MAILER` ≠ `log`/`array` + `MAIL_*` (Laravel sends
verification, reset and invitation e-mails once `auth`/`team` are on), `QUEUE_CONNECTION`,
`QUEUE_WORKER_VIA_SCHEDULER`, `CACHE_STORE`, `SESSION_DRIVER` ≠ `database`, `DOCUMENTS_DISK`
(+ `AWS_*` if S3, see § 5.3), `SMS_WORKER_*`, rate-limit overrides, `SITE_*`.

### 3.4 BFF pattern (verified in code)

The browser only calls the Next.js origin. `src/lib/laravel-api.ts` and `src/lib/laravel/route.ts` are
`server-only`; no client component imports them; no `NEXT_PUBLIC_` variable names Laravel; the session
cookie (`__Host-sf_session`, httpOnly) is turned into `Authorization: Bearer` server-side, and only on
dashboard/admin calls — public API proxies forward only the customer's own `Authorization` header (tested).
Laravel CORS never allows credentials (tested).

## 4. `LARAVEL_FEATURES` — exact syntax (src/lib/laravel/flags.ts)

- Comma-separated; whitespace around items is trimmed; empty items ignored. Unset/empty → all Prisma.
- Names (case-sensitive): `auth profile dashboard contacts templates senderIds campaigns reports wallet
  payments developers team notifications support admin public publicApi webhooks worker`.
- `all` adds every feature. `-name` removes a feature **that was added earlier in the list**: order matters
  (`all,-payments` = everything but payments; `-payments,all` = everything).
- **Unknown or misspelled names are silently ignored** (e.g. `senderids` keeps sender IDs on Prisma). Check
  `GET /api/health` → `laravelFeatures` after each change: it lists the parsed set.
- Read from `process.env` on every request, but set it in the Hostinger app environment and **redeploy** so
  build-time prerendered pages agree; `/pricing` and `/contact` are ISR (`revalidate = 300`) and may show the
  previous source for up to 5 minutes.

## 5. Pre-flight (before any flag)

1. **Back up** the production database (Hostinger snapshot or `mysqldump`) and the Next.js document directory.
2. **Deploy the Laravel backend** (`backend/` changes in § 2) with the usual `deploy/hostinger.sh` flow.
   No migration is needed — do not run `migrate` for this release. Run `php artisan app:schema-check` (read-only).
3. **Verify the deployment** (unauthenticated → now 401, not 404/405):
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" https://smsbackend.hivelabsbd.com/api/v1/app/sms/composer
   ```
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" https://smsbackend.hivelabsbd.com/api/v1/admin/settings/billing-policy
   ```
4. **Health/DB**: `GET /api/v1/health` → `{"status":"ok","database":"ok"}` several times; investigate the
   transient 503 seen on 2026-10-08 (`req_JiM3tzND0sbRtOzs`) in the Laravel log / Hostinger DB connection limits.
5. **Readiness** (on the server or your machine; do not paste the secret into chat/tickets):
   ```bash
   curl -s -H "Authorization: Bearer $CRON_SECRET" https://smsbackend.hivelabsbd.com/api/v1/internal/ready
   ```
   Every check must be `ok` **except `scheduler`**, which stays `fail` (503 overall) until Laravel's cron
   runs `schedule:run` — expected before the `worker` stage. Required checks: `database`, `cache`, `secrets`
   (all five secrets present with the right length), `appKey`, `debugOff`, `smsProvider`, `smsWebhookSecret`,
   `mockPaymentsOff`, `mailer`, `sessionDriver`. Also confirm whether a Laravel `schedule:run` cron already
   exists in hPanel: if it does, Laravel is **already** processing the queue next to the Node worker.
6. **Shared secrets match** without revealing them. On the Laravel host, `php artisan app:deploy-check` prints a
   fingerprint (`len N, fp xxxxxxxxxxxx`) per secret. On the Next.js host compute the same formula
   (repeat for `API_KEY_PEPPER`, `SETTINGS_ENCRYPTION_KEY`, `FRONTEND_PROXY_SECRET`, `CRON_SECRET`):
   ```bash
   node -e "console.log(require('crypto').createHash('sha256').update('smsflow-fp:'+process.env.AUTH_SECRET).digest('hex').slice(0,12))"
   ```
   The 12-character prefixes must match.
   Functional check: an **existing** customer API key must work against Laravel directly:
   `GET https://smsbackend.hivelabsbd.com/api/v1/balance` with that key → 200 (read-only).
7. **Next.js env**: set `LARAVEL_API_URL` and `FRONTEND_PROXY_SECRET`, leave `LARAVEL_FEATURES` **unset**, redeploy.
   `GET https://<frontend>/api/health` must be unchanged (no `api` field). Smoke-test login + dashboard.
8. **Documents**: § 5.3.

### 5.3 Sender-ID document storage

Both apps use the same key layout `orgs/<organizationId>/sender-ids/<uuid>.<ext>` and store the key in the DB.

- **Next.js `STORAGE_PROVIDER=local`** (files under `LOCAL_DATA_DIR/storage`): copy to Laravel's private disk
  **on the Laravel host** (dry run first; it never overwrites or deletes):
  ```bash
  node scripts/copy-sender-id-documents.mjs --from <LOCAL_DATA_DIR>/storage --to <backend>/storage/app/private
  ```
  Then re-run with `--apply`. Conflicts (same key, different size) are reported, not overwritten — stop and
  investigate any. If the two apps run on different hosts, transfer the `orgs/` tree first (rsync without
  `--delete`), then run the script there.
- **Next.js `STORAGE_PROVIDER=s3`**: **blocked today** — `league/flysystem-aws-s3-v3` is not installed in
  `backend/` (only suggested by laravel/framework), so `DOCUMENTS_DISK=s3` fails. Add the package, redeploy,
  map `STORAGE_S3_*` → `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION`, `AWS_BUCKET`,
  `AWS_ENDPOINT`, `AWS_USE_PATH_STYLE_ENDPOINT` (same bucket), and verify one download before `senderIds`.
- Verify: as an admin in Prisma mode, open one existing document; after `senderIds`, open the same one.

## 6. Staged rollout

One stage per deploy. After each: watch for **30 min** (busy features: a full business day before the next
stage) — Next.js logs (`laravel api error`, `laravel proxy failed`, `laravel api unreachable`, with
`requestId`), Laravel `storage/logs/laravel.log` (5xx, `rejected delivery webhook`, `payment callback`),
`/api/health` (`api: ok`), `/internal/ready`, and the specific checks listed. Stop and roll back on any
sustained 5xx, any 401 storm (logouts), or any wallet/balance anomaly.

Rollback for every stage: set `LARAVEL_FEATURES` to the previous stage's value (or remove the name) and
redeploy Next.js. Sessions, data and documents are shared, so users stay logged in. Extra steps are listed.

| # | `LARAVEL_FEATURES` | Verify | Extra rollback step |
|---|---|---|---|
| 1 | `auth` | login (email + phone), logout, wrong password message, register (staff test address), forgot/reset e-mail arrives (Laravel mailer), verify-email link points to `APP_URL`, session survives redeploy; `/api/health.laravelFeatures = ["auth"]` | none (sessions shared both ways, tested) |
| 2 | `auth,profile,notifications` | settings save, sessions list/revoke, prefs, notifications list/mark-read | none |
| 3 | `…,dashboard` | dashboard numbers equal Prisma's for 2–3 accounts (compare before switching) | none |
| 4 | `…,templates` | create/edit/delete a template on a staff org | none |
| 5 | `…,contacts` | add/search/import (small CSV)/export on a staff org | none |
| 6 | `…,senderIds` (after § 5.3) | list, download an **existing** document, upload a new one on a staff org | new uploads made via Laravel live only on Laravel's disk: copy them back to `LOCAL_DATA_DIR/storage` (no overwrite) before rolling back |
| 7 | `…,reports` | reports page, message log, export | none |
| 8 | `…,wallet` | wallet page, transactions, invoice PDF/print, threshold, export | none |
| 9 | `…,payments` (`PAYMENT_PROVIDERS=manual` in both apps) | manual top-up → reference → admin approval (on Prisma admin) for a staff org; balance credited **once** | none (idempotent; payments shared) |
| 10 | `…,campaigns` + `worker`, then disable the Node cron (`/api/internal/worker/tick`) and enable Laravel's `schedule:run` cron | send page loads (composer), a campaign to staff numbers is sent and delivered; `/internal/ready` fully `ready` | remove `campaigns,worker`, **re-enable the Node cron, disable Laravel's cron** |
| 11 | `…,developers` | API keys list/create (shown once)/revoke, API logs, webhooks | none |
| 12 | `…,team,support` | invite (e-mail via Laravel), revoke, ticket create/reply | none |
| 13 | `…,public` | `/pricing` (after ≤5 min ISR), contact + abuse forms | none |
| 14 | `…,publicApi,webhooks` | an existing customer key: `/api/v1/balance`, `/sms/send` to a staff number; delivery webhook arrives (provider dashboard), payment return redirect | none — provider callback URLs stay on the Next.js domain throughout |
| 15 | `…,admin` (equivalently `all`) | every admin page, sender-ID/payment/campaign review, document download | none |

Notes: `campaigns` and `worker` go together so one processor owns the queue; `webhooks` stays on the
Next.js URLs (proxy), so provider settings never change and rollback needs no provider-side action.

## 7. Remaining production blockers

1. Backend changes in § 2 are **not deployed** (verified by probes) — `campaigns`, `wallet`, `public` and
   `admin` need them; `auth` … `contacts` do not.
2. `/internal/ready` has not been run in production with `CRON_SECRET` (needs you).
3. Shared-secret equality and Laravel mailer/`TRUSTED_PROXIES` in production are unverified (no access here).
4. Production `STORAGE_PROVIDER` is unknown here: if `s3`, the Laravel S3 adapter is missing (§ 5.3).
5. Whether a Laravel `schedule:run` cron already runs in production is unknown (§ 5 step 5).
6. One transient production `503` (DB) seen on `/health` (2026-10-08) is not explained yet.
7. The `api-logs` permission broadening (§ 2) needs an explicit OK.
8. Local tests prove behaviour, not production readiness: each stage still needs the live checks above.
