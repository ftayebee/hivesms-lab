# 14 · Frontend → Laravel cutover: audit, implementation, rollout

Date: 2026-10-08. Scope: connect the Next.js app to the Laravel API (`https://smsbackend.hivelabsbd.com/api/v1`)
without redesigning the UI, without schema/data changes, and with Prisma kept as the rollback path.

## 1. Audit before changes (re-scanned)

`node scripts/audit-prisma-usage.mjs` (repeatable; `--json` for machine output). Before any change:

| Metric | Count |
|---|---|
| Prisma calls in `src/` | 471 (674 incl. tests/seed/scripts) |
| Files with Prisma calls | 67 (incl. tests/seed) |
| Exported functions in those files | 305 |
| Server actions (`"use server"`) | 78 in 12 files |
| Route handlers | 30 |
| Files using the Laravel client | 0 |

## 2. Architecture (verified in code)

Browser → Next.js only (BFF). Next.js server → Laravel with `Authorization: Bearer <session token>` read from its own
httpOnly cookie. Consequences:

- **No `credentials: "include"`**, no browser CORS calls. Laravel CORS: allow-origin = frontend only, `supports_credentials=false` (tested).
- Cookie unchanged: `__Host-sf_session` (prod), httpOnly, Secure, SameSite=Lax, path `/`, on the Next.js origin only.
- CSRF: Next server actions have origin checks; Laravel uses Bearer tokens (not sent automatically). Proxied cookie-auth
  admin JSON writes keep the same-origin check.
- One session system: the `sessions` table, `sha256(token)`; sessions created by either backend are valid in the other (tested both ways) → no logout at cutover or rollback.
- `FRONTEND_PROXY_SECRET` (same value in both apps) lets Laravel use the browser IP for per-IP limits. **Without it all users share the Next.js server IP** (register 5/h, login 20/10 min) — a warning is logged once in production.

## 3. Implementation

- `src/lib/laravel-api.ts` — the only Laravel client: GET/POST/PUT/PATCH/DELETE, JSON + multipart, URL with/without `/api/v1`, retries for GET on network/502/503/504 only, timeouts, request IDs, error kinds for 401/402/403/404/409/422/429/5xx, `laravelPage()` (401→/login, 404→not-found), `laravelDownload()` (streamed CSV/docs). 5xx text is never shown; request IDs are logged.
- `src/lib/laravel/errors.ts` — `LaravelApiError`; validation contract `details.fields[{path,message}]` and `details.field` mapped into the existing `ActionResult.fieldErrors` by `actionError()` — no second error format.
- `src/lib/laravel/flags.ts` — `LARAVEL_FEATURES` per-feature switch (`all`, list, `-name` exclusions). Unset = Prisma everywhere.
- `src/features/*/laravel.ts` — Laravel implementations returning the same shapes (Dates, Decimals) as the Prisma functions; each Prisma function starts with `if (laravelEnabled("x")) return viaLaravel.fn(...)`. Prisma bodies untouched.
- `src/lib/laravel/route.ts` — `downloadRoute` (exports/documents) and `proxyRoute` (customer API, webhooks with raw body + signature headers, payment return, admin JSON) keep every existing URL.
- `src/lib/laravel/auth-json.ts` — first-party `/api/v1/auth/*` JSON routes keep their snake_case contract.
- Worker: with `worker` the Node tick/in-process/standalone worker stand down; Laravel `schedule:run` (`sms:work`) is the only processor.

### Backend additions (tests added; **redeploy backend before enabling the affected flags**)

| Change | Needed for |
|---|---|
| `GET /app/sms/composer` (segmentation, quiet hours, opt-out text, plan rates, balance) | `campaigns` (send page) |
| `/app/payments/methods` → `policy` (VAT, min/max top-up, validity) | `wallet` |
| `/app/payments/{id}` → `meta.manualInstructions` | `wallet` (manual payments) |
| `/public/pricing` → `maximumTopUp`, `balanceValidityMonths` | `public` |
| `/admin/overview` → `smsProvider`; `GET /admin/settings/billing-policy` (pricing managers) | `admin` |
| `/admin/api-logs` permission `admin:messages:read` (as the Next page); admin messages `provider` filter + staff-only `providerMessageId` + search audit; audit-logs include organization; abuse reports NEW-first; `CampaignResource.organization.createdAt` when loaded | `admin` parity |

### Small frontend fixes found by the tests
- Email verification now `revalidatePath("/dashboard","layout")` before redirect (stale "verify" banner; pre-existing).
- Logout expires the `__Host-` cookie with matching attributes (it previously survived, harmless but untidy; pre-existing).
- Next.js control-flow errors are re-thrown around Laravel calls (`unstable_rethrow`).

## 4. Feature matrix

| Feature (flag) | Current Prisma / server actions | Laravel endpoints | Frontend files | Status |
|---|---|---|---|---|
| Auth (`auth`) | session-store, auth/service; login/register/logout/forgot/reset/resend/otp/verify/changePassword/switchOrg/createOrg, invite accept/signup | `/auth/*`, `/profile/password` | lib/auth/session.ts, features/auth/actions.ts, team/actions.ts, (auth)/verify-email, invite, api/v1/auth/* | Implemented, tested (integration + E2E) |
| Profile/settings (`profile`) | settings/service; updateProfile/Org, sessions, prefs, leave, setLocale | `/profile*`, `/app/organization*` | settings page, settings actions | Implemented, typechecked |
| Dashboard (`dashboard`) | reports/queries (7 queries) | `/app/dashboard` | dashboard/page, reports/dashboard.ts | Implemented, E2E |
| Shell (with `auth`) | layout counts/wallet/org | `/auth/me` | dashboard/layout | Implemented, E2E |
| Contacts/groups/suppression/import/export (`contacts`) | contacts/service (50) + 8 actions | `/app/contacts*`, `/app/contact-groups*`, `/app/suppression*` | contacts pages, export route | Implemented, E2E (add, conflict, search, import, export) + tenant test |
| Templates (`templates`) | templates/service | `/app/templates*` | templates page | Implemented |
| Sender IDs (`senderIds`) | sender-ids/service, storage | `/app/sender-ids*` (multipart, documents) | sender-ids page, document route | Implemented, E2E (upload + download + anon denied) |
| Campaigns + SMS composer (`campaigns`) | campaigns/service, campaign-runner, 5 actions | `/app/campaigns*`, `/app/sms/composer` | send page, campaigns pages, export route | Implemented, E2E (send, delivery) |
| Reports/messages (`reports`) | reports/queries, messages | `/app/reports/*`, `/app/messages/{id}` | reports pages, export route | Implemented, E2E |
| Wallet (`wallet`) | wallet/service | `/app/wallet*`, `/app/payments/{id}` | wallet, transactions, invoice, payment pages, export | Implemented, E2E |
| Payments (`payments`) | wallet actions, billing/payments | `/app/payments*` | top-up, reference, cancel, mock checkout | Implemented, E2E (mock) |
| API keys/logs/webhooks (`developers`) | developers/service, 4 actions | `/app/api-keys*`, `/app/api-logs`, `/app/webhooks*` | api pages | Implemented, E2E (key shown once) |
| Team (`team`) | team/service, 5 actions | `/app/team*` | team page | Implemented |
| Notifications (`notifications`) | settings/service | `/app/notifications*` | notifications page | Implemented |
| Support (`support`) | support/service, 3 actions | `/app/support/tickets*` | support pages | Implemented |
| Admin (`admin`) | admin/service, config, overview, 20 actions, 8 pages with direct queries, 6 JSON routes | `/admin/*` | app/admin/**, features/admin/page-data.ts | Implemented, E2E (all pages + review) |
| Public (`public`) | pricing, site content, contact/abuse forms | `/public/*` | marketing pricing/contact, settings.ts | Implemented |
| Customer API on this domain (`publicApi`) | api handler + send service | same paths (proxy) | api/v1/sms/*, messages, balance, sender-ids | Implemented (proxy), E2E: estimate 200, scope enforced (403), invalid key 401, logs visible |
| Webhooks/payment return (`webhooks`) | delivery/inbound/callbacks | same paths (proxy) | api/v1/webhooks/*, payments return | Implemented (proxy), E2E: delivery webhook answered by Laravel (request id); payment return not E2E-tested |
| Background worker (`worker`) | Node worker | `schedule:run` / `sms:work` | tick route, instrumentation, scripts/worker | Implemented |

Production status of every row: **not switched** (flags are off until set in the production env).

## 5. Testing (2026-10-08, local stack: MariaDB 10.4, Laravel on :8000 with mock SMS / mock+manual payments)

| Check | Result |
|---|---|
| Laravel `php artisan test` | 210 passed (2,553 assertions); `pint --test` passed |
| Next `tsc --noEmit`, `eslint`, `next build` | pass |
| Vitest unit (incl. 21 new client tests) | 112 passed |
| Vitest `laravel` project (auth, sessions, tenant isolation, admin 403) | 10 passed |
| Playwright Laravel mode, **Next.js DATABASE_URL pointing at a non-existent DB** | 3 passed: customer journey; admin pages + review; templates, team invite, support ticket + reply, settings, notifications, campaigns, webhooks/groups/suppression pages, customer API + webhook proxies, marketing pages + contact form. No browser request to Laravel |
| Playwright Prisma mode (flags off, rollback path) | original journey + marketing + admin pages: passed |
| Prisma integration suite (flags off; own DB `smsflow_test_cutover`, original 6 files) | 49/50 under load, the 1 failure a P2028 transaction-start timeout while another suite ran on the same MariaDB; re-run on a quiet machine: `mysql-portability` 9/9 → 50/50. Do not run two integration suites against the same test database at once (they reset it). |

Commands: see headers of `tests/laravel/auth-cutover.test.ts` and `tests/e2e/laravel-cutover.spec.ts` (local targets only; both refuse non-local URLs / need explicit env).

## 6. Production checks done

- `GET /api/v1/health`: ok on 5 retries; **one transient 503 (DB) observed, request `req_JiM3tzND0sbRtOzs`** — check Laravel logs / Hostinger DB connection limits.
- `GET /internal/ready`: returns 401 without the production `CRON_SECRET` (not available locally) — run it yourself before switching.
- Production was not otherwise contacted; no data written.

## 7. Rollout (one flag at a time, verify, then next)

> Superseded in detail by [16-production-cutover-runbook](16-production-cutover-runbook.md) (2026-10-09): exact flag syntax, env matrix, per-stage checks and rollback.

Prerequisites: deploy the backend changes above; Next env (server-only): `LARAVEL_API_URL=https://smsbackend.hivelabsbd.com/api/v1`,
`FRONTEND_PROXY_SECRET` (= backend), and `AUTH_SECRET`, `API_KEY_PEPPER`, `SETTINGS_ENCRYPTION_KEY` **identical in both apps (≥32 chars)**;
`/health` and `/internal/ready` green.

Order: `auth` → `profile,notifications` → `dashboard` → `contacts` (copy documents first, see below) → `templates` → `senderIds` → `campaigns` (+ `worker` at the same time, then disable the Node cron) → `reports` → `wallet` → `payments` (keep `PAYMENT_PROVIDERS=manual`) → `developers` → `team,support` → `public` → `publicApi,webhooks` (then point provider callbacks at the API host) → `admin` last.

Sender-ID documents: `node scripts/copy-sender-id-documents.mjs --from <LOCAL_DATA_DIR>/storage --to <backend>/storage/app/private [--apply]` (never overwrites or deletes; with S3 set `DOCUMENTS_DISK` to the same bucket instead — **requires adding `league/flysystem-aws-s3-v3` to the backend first**, see doc 16 § 5.3).

**Rollback**: remove the feature from `LARAVEL_FEATURES` (or `all,-x`) and restart Next.js. Sessions, data and documents are shared, so nothing else changes. For `worker`, re-enable the Node cron when removing it.
