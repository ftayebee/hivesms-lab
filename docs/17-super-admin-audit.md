# 17 · Super Admin panel — audit and gap analysis

Date: 2026-10-09. Written **before** implementation (Phase 1). Inputs: `backend/` (routes, controllers,
services, middleware, models), `prisma/schema.prisma` (the shared schema), `src/app/admin/**`,
`src/features/admin/**`, `src/lib/auth/permissions.ts`, docs 14–16.

## 1. What exists

### 1.1 Identity and authorization

| Concept | Where | Notes |
|---|---|---|
| Platform role on the user | `users.platformRole` enum `USER, SUPPORT, ADMIN, SUPER_ADMIN` | Separate from organization roles. `SUPER_ADMIN` is the platform owner. |
| Platform permission matrix | `App\Auth\Permissions::PLATFORM` + `src/lib/auth/permissions.ts` `PLATFORM_PERMISSIONS` (fixed in code, identical) | 14 permissions. Not editable at runtime → cannot be escalated from the UI. |
| Enforcement | `platform:<perm>` middleware (`RequirePlatformPermission`), after `auth.session`, on **every** `/admin/*` route | Customers (`USER`) never pass. Frontend `requirePlatform()` only decides what to render. |
| Organization access | `ResolveTenant` builds the tenant from **membership** of the session's active org | A platform role grants **no** organization permissions (verified: `SessionService::tenantFor`). |
| Session / login | `sessions` table (sha256 token), login rate limit 20/10 min per IP, account lockout (`failedLoginCount`, `lockedUntil`) | Shared with Next.js. |
| Audit log | `audit_logs` (actor, action, org, target, ip, UA, metadata JSON) via `AuditLogger` (must succeed inside a transaction) | No reason field; reason goes into metadata. |
| Bootstrap | `scripts/bootstrap.ts` (`npm run db:bootstrap`, Prisma) with `BOOTSTRAP_ADMIN_EMAIL` | Promotes on **every** run, no confirmation, prints a password. No Laravel equivalent. |

### 1.2 Admin features (Laravel API + Next.js pages, dual-path behind `LARAVEL_FEATURES=admin`)

| Area | Laravel | Next.js page | State |
|---|---|---|---|
| Overview | `GET /admin/overview` (users, orgs, suspended, SMS today/30 d, failed 24 h, payments 30 d, queues, 30-day series) | `/admin` | Exists. "revenue30" is **payment receipts**, labelled revenue. No liability, no refunds, no date filter, no plan distribution. |
| Customers list | `GET /admin/customers?q&status&sort` (name or member email) | `/admin/customers` | Exists. No phone / ID / plan / registration-date filters. |
| Customer detail | `GET /admin/customers/{id}` (org, wallet, members, sender IDs, 8 campaigns, 8 payments, 10 tx, 30-day sent/failed, 15 audits) | `/admin/customers/[id]` | Exists. Missing: API keys, support history, verification status, plan history. |
| Suspend / reactivate | `POST /admin/customers/{id}/status` (reason required for suspend) | yes | Exists; enforcement verified (API keys `org_suspended`, `assertActive` in send/campaign/sender-ID/billing, dispatcher skips). Reactivation needs no reason. |
| Account controls (limits, review flag, plan) | `PUT /admin/customers/{id}/controls` (audited before/after) | yes | Exists. "Mark for review" = `requireCampaignReview`. Plan assignment = `pricingPlanId`. |
| Password recovery for a customer | — | — | **Missing.** |
| Wallets | `GET /admin/wallets` (+ total balance) | `/admin/wallets` | Exists, labelled liability. |
| Manual wallet adjustment | `POST /admin/customers/{id}/wallet-adjustments` (`admin:billing:manage` = ADMIN + SUPER_ADMIN) | form on customer page | Exists, ledger + audit, never negative. **Not idempotent** (random UUID reference → a retried request applies twice). No re-authentication. |
| Payments review | `GET /admin/payments`, `POST /admin/payments/{id}/review` | `/admin/payments` | Exists. `PaymentService::complete` locks the row, status-guarded update, unique ledger key → **no double credit** (tested). |
| Payment refunds | — (`PaymentStatus.REFUNDED` exists, unused) | — | **Missing.** |
| Platform ledger / finance reports | — | — | **Missing** (only per-customer last 10 tx). |
| Pricing plans & packages | `/admin/pricing/plans|packages`, billing policy | `/admin/pricing` | Exists. Rates `DECIMAL(10,4)`. Changes audited with full before/after, **no reason**, no impact count; validation `numeric` (accepts `1e2`). |
| Provider costs / margins | — | — | **Missing**; no table or column stores provider cost. |
| Subscriptions | — | — | **Does not exist.** Model is prepaid wallet + per-SMS plan rates; packages are top-up bundles, not subscriptions. |
| Sender IDs | list / review / documents | `/admin/sender-ids` | Exists (fee charged once via unique ledger key). |
| Campaign review, messages, API logs | yes | yes | Exists. |
| Abuse, blocklist, leads | yes | `/admin/abuse` | Exists. |
| Support | yes | `/admin/support` | Exists. |
| Staff (users) | `GET /admin/users`, `PUT /admin/users/{id}/access` (SUPER_ADMIN only, self-change blocked, last super admin cannot be demoted, sessions revoked) | `/admin/users`, `/admin/roles` (matrix) | Exists with gaps below. No staff invitation. |
| Settings | SMS policy/provider, payments, site content (secrets only as set/not set) | `/admin/settings` | Exists. |
| Audit logs | `GET /admin/audit-logs` | `/admin/audit-logs` | Exists. No export. |
| System health | `/internal/ready` (CRON_SECRET) | — | Not available to staff in the panel. |
| Exports | customer-side CSV exports only (`Csv` helper with formula-injection protection) | — | **No admin exports.** |

## 2. Security findings in the existing code

| # | Finding | Severity | Fix in this phase |
|---|---|---|---|
| S1 | `updateUserAccess`: the last-super-admin guard covers demotion but **not suspension** → the last active owner can be suspended (locking everyone out). | High | Guard both; row locks so two concurrent demotions cannot both pass. |
| S2 | Privilege changes need no reason and no re-authentication; a stolen staff session can grant `SUPER_ADMIN`. | High | Mandatory reason + current-password confirmation; rate-limited. |
| S3 | Manual wallet adjustments are not idempotent and available to `ADMIN`. | High | Idempotency key mapped onto the unique ledger reference; new `admin:wallet:adjust` (SUPER_ADMIN), password confirmation, reason. |
| S4 | `scripts/bootstrap.ts` re-promotes `BOOTSTRAP_ADMIN_EMAIL` on every run and prints a password. | Medium | Laravel one-time CLI with explicit confirmation that refuses when an owner exists and issues a short-lived reset link; Node script stops promoting when an owner exists. |
| S5 | Plan rates validated with `numeric` (accepts exponent notation); no reason recorded for price changes. | Low | Decimal regex; mandatory reason on updates; impact count. |
| S6 | Admin overview labels payment receipts as "revenue". | Low (misleading) | Separate liability / receipts / refunds / usage revenue. |
| S7 | Customer reactivation needs no reason. | Low | Reason required for both directions. |

No secret exposure found: `UserResource`, `ApiKeyResource` and settings responses never include hashes or secrets (verified).

## 3. Gap analysis by requested feature

| # | Requested | Exists | Gap → decision |
|---|---|---|---|
| 1 | Customers & organizations | list, detail, suspend, controls | add filters (phone, ID, plan, registration date), API-key status, support history, verification, plan history; password-reset initiation; reason for reactivation |
| 2 | Plans & pricing | plans, packages, billing policy | reason + impact count + change history (from audit); stricter decimal validation. Versioned plans → schema proposal (§ 4) |
| 3 | Subscriptions | none | **Not implemented as recurring billing** (no recurring-payment integration exists). Plan assignment history from audit logs. Schema proposal in § 4 for approval |
| 4 | SMS pricing, markup, packages | plan rates, packages, per-message `unitPrice`/`cost` snapshot | provider wholesale rates in `settings` (no schema change); margin report marked **estimate** |
| 5 | Wallets, transactions, manual top-ups | wallets list, adjustments, payment review | platform ledger with filters + export; idempotent, re-authenticated adjustments; payment refunds through the ledger |
| 6 | Sender ID approvals | complete | reuse |
| 7 | Campaigns, messages, abuse | complete | reuse |
| 8 | Staff, roles, permissions | users page, matrix page | staff invitation, reason + password on changes, S1 fix, privileged-action history |
| 9 | Settings, audit, health | settings, audit list | audit export; staff-visible health checks (no secrets) |

## 4. Schema: proposals only (not applied)

The implementation needs **no migration**. Two concepts have no representation; smallest backward-compatible
proposals, to be approved before any migration is written or run:

1. **Plan versions** (`pricing_plan_versions`: id, planId, version, the four rates, senderIdFee, minRechargeAmount,
   effectiveFrom, createdById, reason, createdAt) + nullable `organizations.pricingPlanVersionId`. Today a rate
   change applies to every organization on the plan **from the next message**; already-sent messages keep their
   `unitPrice` snapshot and wallet balances are BDT (not SMS credits), so nobody is re-charged retroactively.
   Versions would let existing customers keep a rate until a chosen date.
2. **Subscriptions** (`organization_subscriptions`: id, organizationId, planId, status `PENDING|TRIALING|ACTIVE|PAST_DUE|CANCELED|EXPIRED`,
   startsAt, endsAt, trialEndsAt, graceEndsAt, priceSnapshot DECIMAL(14,4), billingPeriod, paymentId, invoiceId,
   createdById, reason, timestamps). Only worth adding once a recurring fee exists; activation and payment
   verification would stay separate manual workflows (no automatic renewal or charging claims).

Provider costs are stored in the existing `settings` table (`sms.provider.costs`), with change history in `audit_logs`.

## 5. Role and permission design (decided)

Platform roles stay the existing four (no enum migration). `SUPER_ADMIN` is the platform owner.
New permissions are added to the code matrix (Laravel and TypeScript kept identical):

| Permission | SUPPORT | ADMIN | SUPER_ADMIN | Used for |
|---|---|---|---|---|
| `admin:finance:read` | | ✓ | ✓ | finance dashboard, platform ledger, margins |
| `admin:reports:export` | | ✓ | ✓ | CSV exports (plus the resource's own read permission) |
| `admin:health:read` | | ✓ | ✓ | system health panel |
| `admin:wallet:adjust` | | | ✓ | manual credit/debit (was `admin:billing:manage`) |
| `admin:payments:refund` | | | ✓ | refunds of confirmed payments |
| `admin:costs:manage` | | | ✓ | provider wholesale rates |

Unchanged: `admin:users:manage` (staff administration) and `admin:settings:manage` stay SUPER_ADMIN-only;
`admin:billing:manage` (manual-payment verification) stays ADMIN + SUPER_ADMIN; SUPPORT gets no financial permission.
