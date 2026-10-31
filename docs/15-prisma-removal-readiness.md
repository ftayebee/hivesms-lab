# 15 · Prisma removal readiness

Final scan 2026-10-08 (`node scripts/audit-prisma-usage.mjs`): **470 Prisma calls in `src/`** (674 incl. tests, seed,
scripts), 59 files with calls, 78 files importing Prisma/`@/lib/db`, 78 server actions (all kept as thin entry points;
their Laravel branches contain no business logic), 30 route handlers (all now dual-path).

**Verdict: Prisma is NOT safe to remove yet.** No production feature has been switched; every remaining use is the
rollback path. Do not uninstall Prisma until all flags have run in production long enough to trust them.

| Use | Files | Classification |
|---|---|---|
| Prisma branches of feature services (each guarded by `laravelEnabled`) | features/{auth,settings,contacts,templates,sender-ids,campaigns,reports,wallet,developers,team,support,admin,public}/*, services/{settings,billing/pricing}.ts, page loaders (reports/dashboard.ts, reports/page-data.ts, campaigns/composer.ts, admin/page-data.ts) | MIGRATION FALLBACK |
| Modules only reachable from those branches | lib/auth/session-store.ts, lib/api/{handler,api-keys}.ts, lib/rate-limit.ts, lib/audit.ts, features/admin/overview.ts, features/auth/service.ts, features/organizations/provision.ts, features/reports/queries.ts, campaigns/actions.ts (launch), services/{billing/*,messaging/*,notify,payments/callbacks}.ts | MIGRATION FALLBACK |
| Node worker | scripts/worker.ts, api/internal/worker/tick, instrumentation.ts | MIGRATION FALLBACK (stands down with `worker`) |
| Prisma-mode route handlers kept behind proxies | api/v1/** (`prismaGET/POST`) | MIGRATION FALLBACK |
| `lib/db.ts`, `db-errors.ts`, `sql.ts`, generated client | | STILL REQUIRED (until all fallbacks go) |
| Enum/Decimal **types** from `@/generated/prisma/*` used by Laravel modules and pages (type-only) | features/*/laravel.ts, lib/auth/context.ts, lib/laravel/session.ts, services/sms/types.ts, public-api/serializers.ts | STILL REQUIRED — replace with local string-union types before removal |
| `scripts/bootstrap.ts`, `prisma/seed.ts` | | STILL REQUIRED (seeding) — port to a Laravel seeder before removal |
| tests/integration/*, tests/support/factories.ts, tests/laravel (uses Prisma to inspect DB) | | TEST ONLY |
| Health route DB check | api/health | MIGRATION FALLBACK (skipped when all features are on Laravel) |
| UNKNOWN | — | none found |

Empirical check: with `LARAVEL_FEATURES=all` and `DATABASE_URL` pointing at a non-existent database, the customer
journey, all admin pages and the remaining customer pages, customer-API and webhook proxies passed (doc 14 § 5) — the
covered paths make no Prisma calls. Not covered: payment-gateway return (needs a real gateway), phone OTP.

Removal steps (later): run all flags in production → delete Prisma branches + fallback modules → replace generated types
→ port seeding → remove `prisma/`, `prisma.config.ts`, `src/generated`, deps, `postinstall`, `DATABASE_URL`.
