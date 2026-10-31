# 18 · Super Admin panel — operations, security model, deployment

Date: 2026-10-09. Gap analysis: [17-super-admin-audit](17-super-admin-audit.md). Cutover context: [14](14-frontend-laravel-cutover-audit.md)–[16](16-production-cutover-runbook.md).
**Nothing here has been applied to production**: no migration, no account, no flag, no financial mutation.

## 1. What was built

Laravel is authoritative for every rule, permission and write. The browser talks only to Next.js; Next.js calls Laravel
server-to-server (BFF). New Super Admin features exist **only** in Laravel — there is no Prisma copy; their pages say
so when `LARAVEL_FEATURES` does not include `admin`. Security fixes to existing features were applied to **both** paths,
because production runs the Prisma admin path until the `admin` flag is enabled.

| Area | Reused | New / changed |
|---|---|---|
| Access & roles | `users.platformRole` (USER/SUPPORT/ADMIN/SUPER_ADMIN), code-defined matrix, `platform:` middleware | 6 new permissions (§ 3); `PrivilegedActionGuard` (password re-confirmation, lockout, rate limit); `StaffService` (no self-change, last-owner guard with row locks incl. suspension, reason, audit); staff invitations; owner bootstrap command |
| Dashboard | `/admin/overview`, work queues | `GET /admin/dashboard?range=` — customers by status (incl. pending verification), plan distribution, SMS today / month / period by status, queues, finance block (finance:read), recent privileged actions (audit:read); overview "Revenue" relabelled **Payment receipts** |
| Customers | list, detail, suspend, controls (plan, limits, review flag) | search by name, ID, member e-mail / name / phone; filters plan, registration dates, review flag; detail adds API-key status (no hashes), support history, e-mail verification, 30-day status totals, plan history; reason required to reactivate; admin-initiated password-reset e-mail |
| Plans & pricing | plans, packages, billing policy | reason required on updates; audit records only changed fields, `priceChanged`, `affectedOrganizations`; strict decimal validation (no exponent notation) |
| Subscriptions | — | **Not implemented** (no recurring billing exists — § 7) |
| Wallets & payments | `WalletService` ledger, `PaymentService::complete` (row lock, idempotent) | idempotent manual adjustments (SUPER_ADMIN + password + reason); payment refunds through the ledger; platform ledger with filters |
| Provider costs & margins | per-message `unitPrice`/`cost` snapshot | wholesale rates in `settings` (`sms.provider.costs`), margins by customer / plan / campaign / day, labelled **estimate** |
| Staff | users page, roles matrix page | invite, change-access dialog (reason + password), privileged-action history |
| Reports & exports | `Csv` (formula-injection safe) | `GET /admin/exports/{customers,payments,transactions,margins,audit-logs}` (audited, minimised) via `/api/v1/admin/exports/[kind]` |
| Health | `/internal/ready` checks | shared `ReadinessService`; `GET /admin/system/health` for staff (ok/fail only) |

New pages: `/admin/finance`, `/admin/costs`, `/admin/system`; extended: `/admin` (overview), `/admin/customers`,
`/admin/customers/[id]`, `/admin/payments`, `/admin/pricing`, `/admin/users`. Navigation entries appear only for roles
holding the page's permission (convenience — the API is the control).

Localisation: the admin area is English-only today (`I18nProvider locale="en"` in `app/admin/layout.tsx`); the new
pages follow that. Money is shown with `formatBDT`; amounts travel as decimal strings.

## 2. Bootstrap the first Super Admin (for you to run)

Preferred: the Laravel command on the backend host (production environment, after the backend deploy):

```bash
php artisan platform:bootstrap-owner owner@your-company.example --name="Your Name"
```

- It refuses if **any active super admin already exists** (then add owners in Admin → Users).
- It asks you to type the e-mail again (non-interactive: `--confirm-email=owner@your-company.example`).
- New account: random unknown password; existing account: promoted, password unchanged, signed out everywhere.
- It prints **one** single-use link to set the password (valid 60 minutes) to the terminal only — not logged, not e-mailed.
  The link points at `FRONTEND_URL/reset-password`. Open it, set a strong password, sign in at `/admin`.
- Audited as `admin.bootstrap_owner` (actor SYSTEM).

The legacy Node script (`npm run db:bootstrap` with `BOOTSTRAP_ADMIN_EMAIL`) now ignores the variable once an active
super admin exists; unset `BOOTSTRAP_ADMIN_EMAIL` in production after the first owner exists.
Never create staff by editing the database, and never share accounts.

## 3. Roles and permissions

Platform roles live on the user; organization roles live in `roles`/`role_permissions` per organization. A platform
role grants **no** organization permission (tenant context comes from membership only). The matrix is fixed in code,
identical in `backend/app/Auth/Permissions.php` and `src/lib/auth/permissions.ts` (a unit test enforces parity).

| Permission | SUPPORT | ADMIN | SUPER_ADMIN |
|---|---|---|---|
| admin:access, customers:read, messages:read, campaigns:review, support, abuse:manage | ✓ | ✓ | ✓ |
| admin:customers:manage (suspend/reactivate, controls, password-reset e-mail) | | ✓ | ✓ |
| admin:sender_ids:review | | ✓ | ✓ |
| admin:billing:read, admin:billing:manage (verify manual payments) | | ✓ | ✓ |
| admin:pricing:manage (plans, packages, billing policy) | | ✓ | ✓ |
| admin:audit:read | | ✓ | ✓ |
| **admin:finance:read** (finance, ledger, margins) — new | | ✓ | ✓ |
| **admin:reports:export** — new (plus the data's own read permission) | | ✓ | ✓ |
| **admin:health:read** — new | | ✓ | ✓ |
| **admin:wallet:adjust** — new (was billing:manage, ADMIN lost it) | | | ✓ |
| **admin:payments:refund** — new | | | ✓ |
| **admin:costs:manage** — new | | | ✓ |
| admin:users:manage (staff), admin:settings:manage | | | ✓ |

Design decisions: SUPPORT has no financial permission; money movement and staff administration are owner-only.
`admin:pricing:manage` stays with ADMIN (existing behaviour) — change it to SUPER_ADMIN only if you want pricing to be
owner-only (one line in both matrix files). Adding new platform roles (e.g. FINANCE) would need an enum migration; not done.

## 4. Security controls

| Control | Where |
|---|---|
| Server-side authorization on every admin route (`auth.session` + `platform:<permission>`); customers and organization admins get 403 | routes/api.php, `RequirePlatformPermission` |
| Re-authentication: current password on staff access changes, staff invitations, wallet adjustments, refunds, provider costs | `PrivilegedActionGuard` (Laravel), `confirmAdminPassword` (Prisma path) |
| 5 wrong passwords / 15 min → privileged actions locked 15 min; each failure audited (`admin.reauth.failed`, `admin.reauth.locked`); password never logged | same |
| Privileged writes limited to 20 / 10 min per staff user; existing admin limit 120 / min; login 20 / 10 min per IP, 10 per account, lockout | `config/smsflow.php` |
| No self-promotion/demotion; only a super admin grants or revokes staff roles (route + service check) | `StaffService` |
| Last active super admin can be neither demoted nor suspended; owner rows locked (`FOR UPDATE`) so concurrent changes cannot both pass | `StaffService`, Prisma `updateUserAccess` |
| Role/status change revokes all the user's sessions | both paths |
| Reason required: staff access, invitations, suspension **and** reactivation, wallet adjustments, refunds, plan updates, provider costs | requests + services |
| Audit entries: actor, action, target, organization, IP, user agent, timestamp, reason, before/after; written in the same DB transaction as the change (fails closed) | `AuditLogger` |
| Nothing secret in responses or logs: resources whitelist fields; API keys shown as prefix + status; exports omit e-mails, phones, IPs, bodies, hashes | resources, `AdminExportController` (tested) |
| Staff never see or set another person's password; recovery and invitations e-mail a single-use link to the account's own address | `AuthService::sendPasswordResetFor` |

## 5. Money: definitions and rules

| Figure | Definition (UI wording) |
|---|---|
| Customer wallet liability | Sum of wallet balances **now** — prepaid money owed as SMS, never revenue |
| Confirmed payment receipts | `payments.status = SUCCEEDED` in the period; net of VAT (`amount`) and gross (`total`) |
| Payment refunds | Refunds recorded through `POST /admin/payments/{id}/refund` (ledger `payment_refund`) |
| Usage revenue (gross) | SMS charges − failed-SMS refunds + sender-ID fees, from the ledger, excl. VAT |
| Estimated provider cost | segments of messages handed to the provider (`submittedAt` set) × configured wholesale rate |
| Estimated gross margin | billed (charged, not refunded) − estimated provider cost |
| Net profit | **not shown** — gateway fees and other costs are not recorded; provider invoices are not reconciled |

Rules (enforced and tested):
- Balances change only through `WalletService` (row-locked `UPDATE … WHERE balance >= x`, never negative, unique ledger
  key `(reason, referenceType, referenceId)`). There is no endpoint that sets a balance.
- Manual adjustment: SUPER_ADMIN, password, reason ≥ 5 chars, decimal string amount ≤ 2 dp, **idempotency key** (the form
  embeds one per render) → the key is the ledger reference: a retry returns the first result (`replayed: true`); the same
  key with a different amount/direction/org → `409 IDEMPOTENCY_CONFLICT`.
- Manual payment approval (`billing:manage`) is separate from the customer's claim (reference submission) and credits
  once (status-guarded update + unique ledger key). The frontend can never mark a payment successful.
- Refund (SUPER_ADMIN, password, reason): only `SUCCEEDED` payments; debits the credited amount (refused with `409` if the
  customer already used part of it — then refund the unused part with an adjustment); payment → `REFUNDED` with refund
  metadata; once per payment. The money itself is returned outside the system; invoices are not voided automatically
  (issue a credit note with your accountant if required).
- Ledger rows are never edited; corrections are new entries.

## 6. Pricing semantics

- Per-SMS rates apply at **send time** to every organization on the plan (default plan for organizations without one).
- Every message stores its `unitPrice` and `cost`: history never changes and nobody is re-charged retroactively; wallet
  balances are BDT, not SMS credits, so they are not devalued — but **the next messages use the new rate** without notice.
  Before raising rates, announce it to the affected organizations (the save response and audit entry give the count).
- To keep a customer on old rates, create a plan with those rates and assign it (Customers → Account controls).
- Versioned plans with effective dates need a schema change — proposal in doc 17 § 4, not applied.

## 7. Subscriptions

There is no recurring billing: the product is a prepaid wallet with per-SMS plan rates and optional top-up packages.
Nothing in the panel presents top-ups as subscriptions, and nothing claims automatic renewal or charging. "Plan" in the
UI means a rate card assigned to an organization; plan assignment history comes from the audit log.
If recurring plans are wanted, approve the `organization_subscriptions` design in doc 17 § 4 first; activation and payment
verification would stay separate manual workflows until a verified recurring-payment integration exists.

## 8. API reference (new or changed; all under `/api/v1`, session auth)

| Method & path | Permission | Notes |
|---|---|---|
| GET `/admin/dashboard?range=&from=&to=` | admin:access | finance / privileged-action blocks only with their permissions |
| GET `/admin/finance/summary` · `/admin/finance/transactions` · `/admin/finance/margins` · `/admin/finance/provider-costs` | admin:finance:read | `range=today|7d|30d|90d|custom` (+`from`,`to`, ≤ 366 days, Asia/Dhaka days) |
| PUT `/admin/finance/provider-costs` | admin:costs:manage | `{provider, rates{4 decimals}, effectiveFrom, source, reason, currentPassword}` |
| POST `/admin/customers/{id}/wallet-adjustments` | **admin:wallet:adjust** (changed) | `{direction, amount "12.50", reason, idempotencyKey, currentPassword}`; `note` accepted as alias of `reason` |
| POST `/admin/payments/{id}/refund` | admin:payments:refund | `{reason, currentPassword}` |
| POST `/admin/customers/{id}/status` | admin:customers:manage | **reason now required for ACTIVE too** |
| GET `/admin/customers?q=&status=&planId=&review=&from=&to=` | admin:customers:read | extra filters; detail adds `apiKeys, tickets, statusTotals30, verification, planHistory` |
| PUT `/admin/pricing/plans/{id}` | admin:pricing:manage | **`reason` required**; `meta.affectedOrganizations`, `meta.changedFields` |
| PUT `/admin/users/{id}/access` | admin:users:manage | **`reason` and `currentPassword` required** |
| POST `/admin/staff` · GET `/admin/staff/permissions` · GET `/admin/staff/history` | admin:users:manage | invite / matrix / privileged history |
| POST `/admin/users/{id}/password-reset` | admin:customers:manage | staff accounts: super admin only; 3 / hour per account |
| GET `/admin/system/health` | admin:health:read | ok/fail per check |
| GET `/admin/exports/{kind}` | admin:reports:export + data permission | CSV stream, ≤ 100 000 rows, audited (`admin.export`) |

Contract changes break **old** frontends only when they talk to the **new** backend through the `admin` flag. The flag is
off in production, so deploy order is free; deploy the backend first anyway.

## 9. Configuration and schema

- **No new environment variables.** Relevant existing ones: `MAIL_*` (Laravel sends invitations and reset links — must not
  be `log` in production), `FRONTEND_URL` (links point there), `CACHE_STORE` (holds the re-authentication lock; use a
  store shared by all PHP workers — `database`/`redis`/`file` on a single host), `LARAVEL_FEATURES` (`admin` enables the
  new pages), plus everything in doc 16 § 3.
- **No migration, no schema change.** Provider costs use the existing `settings` table. Proposals (plan versions,
  subscriptions) are in doc 17 § 4 and need your approval before any migration is written.

## 10. Tests (local only: MariaDB 10.4, Laravel with mock SMS / mock + manual payments)

| Suite | Result |
|---|---|
| Laravel `php artisan test` (incl. new `SuperAdminTest`, 17 tests; `AdminTest` updated to the new contract) | **227 passed** (2,803 assertions); `pint --test` passed |
| Vitest unit (incl. new permission-parity test) | **115 passed** |
| Vitest `laravel` project (BFF against local Laravel; incl. new `super-admin.test.ts`, 6 tests) | **42 passed** |
| Vitest `integration` (Prisma path; incl. new `admin-security.test.ts`, 4 tests) | **54 passed** (isolated run; see § 10.1) |
| `tsc --noEmit`, `eslint`, `next build` (with `DATABASE_URL` pointed at a local DB) | pass |
| Browser (local prod build, all flags on Laravel, local test super admin) | overview, finance, costs, system, users, customer page; wrong password → field error, no balance change; correct password → one ledger entry keyed by the form's idempotency key; no console errors |

Requested coverage map: unauthorized customer / organization admin → 403 (SuperAdminTest, super-admin.test.ts);
support cannot change pricing, balances, staff or export (both); super admin access (both); no self-promotion (both +
integration); last owner (SuperAdminTest + integration, simulated race); cross-organization isolation (customer detail
does not leak other orgs; tenant routes unchanged, `IdorSweepTest`); price validation + audit + historical prices kept
(SuperAdminTest); duplicate approvals credit once (SuperAdminTest, PaymentTest); atomic, never-negative wallets
(SuperAdminTest, integration, `WalletConcurrencyTest`); suspension blocks SMS + API keys (SuperAdminTest, AdminTest);
refunds/adjustments create ledger entries (SuperAdminTest); exports enforce permissions and exclude secrets/PII (both);
audit logs contain no secrets (SuperAdminTest, integration, super-admin.test.ts).

### 10.1 Prisma integration suite

Run against local `smsflow_test` only. First full run: **27 failed / 27 passed** — failures were unique-key collisions
while re-seeding (`resetDatabase`) and rows disappearing mid-test (P2025/P2003/P2034), i.e. another process truncating the
same test database during the run; tests took 30–50 s instead of ~20 s. The source of the overlap was not identified.
Re-run with the run verified to be the only client of `smsflow_test`: **54 passed, 0 failed** (7 files, 1,145 s).
Treat the integration suite as green only when it runs alone against its database.

## 11. Deployment (requires your approval at each gate)

1. Review and commit (nothing is committed yet). Deploy the **backend** (no `migrate`; run `php artisan app:schema-check`).
2. Verify: `GET /api/v1/admin/dashboard` unauthenticated → 401 (not 404); `/internal/ready` as in doc 16.
3. Deploy **Next.js**. With the `admin` flag still off, the existing admin pages keep working on Prisma with the new
   safeguards (password + reason on access changes and adjustments, owner-only adjustments, reason for reactivation and
   plan updates); the new pages show "needs the Laravel admin API".
4. **Gate — bootstrap**: if there is no active super admin in production, run § 2 yourself. Check existing staff first
   (Admin → Users, filter by role) and demote anyone who should not hold `ADMIN`/`SUPER_ADMIN` — ADMIN loses wallet
   adjustments with this release.
5. **Gate — flag**: enable `admin` last, as in doc 16 § 6 (stage 15). Rollback: remove `admin` from `LARAVEL_FEATURES`
   and redeploy Next.js; admin pages return to the Prisma path (same safeguards; new pages show the notice).
6. **Gate — provider costs**: enter rates only from a signed contract or invoice (source field). Never switch the sending
   provider from this panel; provider configuration stays in Admin → Settings.

## 12. Remaining blockers / open decisions

1. Approval of the API-logs permission change (doc 16) and of ADMIN losing wallet adjustments (this release).
2. Production bootstrap of the first owner (you), production mailer verified (invitations and resets depend on it).
3. Subscriptions and versioned plans: design approval needed (doc 17 § 4) — not implemented.
4. Provider wholesale rates: unknown until you enter verified values; margins stay "not configured" until then.
5. Payment-gateway fees and provider invoices are not recorded → no net-profit or reconciled-cost reporting.
6. Admin UI is English-only (as before); Bangla for the admin area would need translation work.
7. Refunds do not void invoices or create credit notes — confirm the accounting procedure.
8. Everything above is verified locally only; production behaviour needs the staged checks in doc 16 and § 11.
