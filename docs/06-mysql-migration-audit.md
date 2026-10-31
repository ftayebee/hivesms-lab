# PostgreSQL → MySQL/MariaDB compatibility audit

Audit of the codebase at commit `b0fa12d` before any migration change. Every finding below
was located in the actual source; items marked **verified** were confirmed by running
Prisma 7.10 (`prisma validate` / `prisma migrate diff`) or against a real MariaDB server.

Target database: **MariaDB**. Hostinger's Web and Cloud hosting plans run MariaDB, not
Oracle MySQL ([Hostinger: which DBMS is used](https://www.hostinger.com/support/1583226-which-database-management-system-is-used-at-hostinger/)).
Prisma's `mysql` provider supports both. The exact MariaDB version is not published, so the
migrated code is written to work on **MariaDB 10.4+ and MySQL 8.0+** and was tested on
MariaDB 10.4.32 (the oldest version likely to be encountered). That rules out
`SKIP LOCKED` (MariaDB 10.6+), `JSON_TABLE` (MariaDB 10.6+) and `UPDATE … RETURNING`
(not supported by either).

Verdict: **migration is safe** with the schema and query changes listed below. Nothing needs
to be removed; every model, relation, index and unique constraint has a MySQL equivalent.

## 1. Stack facts

| Item | Finding |
|---|---|
| Prisma | 7.10 (`prisma-client` generator, output `src/generated/prisma`). Prisma 7 requires a driver adapter. |
| Adapter | `@prisma/adapter-pg` + `pg` → must become `@prisma/adapter-mariadb` + `mariadb` (Prisma's adapter for both MySQL and MariaDB). |
| `prisma.config.ts` | Already reads `DATABASE_URL` from env. No change needed. |
| Datasource `url` | **Verified:** Prisma 7 rejects `url = env("DATABASE_URL")` in `schema.prisma` (error P1012: "The datasource property `url` is no longer supported in schema files"). The URL stays in `prisma.config.ts`; the datasource block becomes `provider = "mysql"` only. |
| Migrations | 2 PostgreSQL migrations (`init`, `invoice_sequence`), `migration_lock.toml` = postgresql. Prisma migration history is provider-specific and cannot be replayed on MySQL → new MySQL baseline required. |

## 2. Schema (`prisma/schema.prisma`)

| # | Area | PostgreSQL behaviour | MySQL/MariaDB issue | Severity |
|---|---|---|---|---|
| S1 | **Scalar lists** `Contact.tags`, `ApiKey.scopes`, `ApiKey.ipAllowlist`, `WebhookEndpoint.events`, `PricingPlan.features` (`String[]`) | native `text[]` | **Verified blocker:** "The current connector does not support lists of primitive types." Must become `Json`. | Blocker |
| S2 | **UUID** columns (`@db.Uuid`, 120+ fields) | native `uuid` | No uuid type. Use `@db.Char(36)`. Prisma generates UUIDs client-side (`@default(uuid())`), so behaviour is identical. | Blocker |
| S3 | **Unbounded `String`** | `text` (no limit) | Default `VARCHAR(191)`. Longer values fail under strict SQL mode. Affected: message bodies (≤3000), campaign message, template body, emails (validated ≤254), webhook URLs (≤500), user agents, API log paths, provider error codes/messages, idempotency keys (≤255), provider event keys, support/abuse/contact texts, descriptions, notes. | High (silent data loss or insert failures) |
| S4 | JSON defaults (`@default("{}")`, `@default("[]")`) | column default | **Verified:** Prisma emits no DB default for JSON on MySQL but still applies it client-side. All inserts go through Prisma except the rate limiter (no JSON columns). No action. | Info |
| S5 | `SupportTicket.number @default(autoincrement())` (non-id) | `SERIAL` | **Verified:** valid; emitted as `AUTO_INCREMENT` with a unique index (required by MySQL). | Info |
| S6 | Enums (27) | native enum types | Become inline `ENUM(...)` columns. Values identical. Raw SQL casts like `::"MessageStatus"` must go. | Medium (raw SQL only) |
| S7 | `Decimal(14,4)`, `Decimal(10,4)`, `Decimal(5,2)` | `numeric` | `DECIMAL` identical precision. | None |
| S8 | `DateTime` | `timestamp(3)` (no tz) | `DATETIME(3)`. Prisma writes UTC. `NOW()` in raw SQL depends on the session `time_zone` → avoid it / pin session to UTC. | Medium |
| S9 | Unique constraints on nullable columns (`[provider, providerMessageId]`, `[provider, providerRef]`, `[reason, referenceType, referenceId]`) | multiple NULLs allowed | Same in InnoDB. | None |
| S10 | Index key length | no practical limit | utf8mb4 index max 3072 bytes (InnoDB DYNAMIC). Widest planned composite: `payments(provider VARCHAR(191), providerRef VARCHAR(255))` = 1784 bytes. OK. | Checked |
| S11 | **Case sensitivity of `=` and unique indexes** | case-sensitive | `utf8mb4_unicode_ci` is case- and accent-insensitive. See §5. | Medium |
| S12 | CHECK constraints (migration 2): `wallets.balance >= 0`, `wallet_transactions.amount > 0` | enforced | Enforced by MariaDB 10.2+ and MySQL 8.0.16+. Kept. | None |
| S13 | `CREATE SEQUENCE invoice_number_seq` (migration 2) | sequence | Oracle MySQL has no sequences. Replaced by a transactional `counters` table. | Blocker |
| S14 | Charset | UTF8 | Prisma creates every table as `utf8mb4 / utf8mb4_unicode_ci` (**verified** in generated DDL), so Bangla text is stored correctly regardless of server defaults. | None |

## 3. Raw SQL (every `$queryRaw` / `$executeRaw`)

All raw SQL uses tagged templates (`$queryRaw\`…\``/`Prisma.sql`), so values are always bound
parameters. The one `$executeRawUnsafe` is in test support and only interpolates table names
read from the catalogue. SQL-injection protection is intact before and after.

PostgreSQL-only constructs found:

| File | Construct | Issue on MySQL | Fix |
|---|---|---|---|
| **all raw SQL** | `"camelCase"` identifiers | In MySQL, `"x"` is a **string literal** (unless ANSI_QUOTES). Queries would run and silently return wrong results. | Backtick identifiers. |
| `services/messaging/dispatcher.ts` | `UPDATE … WHERE id IN (SELECT … FOR UPDATE OF m SKIP LOCKED) RETURNING id`, `make_interval`, `= ANY(…::uuid[])`, `now()` | No `RETURNING` on UPDATE; can't UPDATE a table selected in a subquery (error 1093); `OF m` and `SKIP LOCKED` unsupported on MariaDB < 10.6; no arrays. | Short transaction: `SELECT … FOR UPDATE` (messages only; campaign/org checks in `EXISTS` subqueries, which InnoDB does not lock) then `UPDATE … WHERE id IN (…)`. Read Committed keeps it free of gap locks. |
| `services/billing/wallet.ts` | `UPDATE … RETURNING id, balance::text`, `::numeric`, `::uuid` | no RETURNING; string→number coercion in MySQL arithmetic goes through DOUBLE | `UPDATE` then `SELECT` inside the caller's transaction (row is locked by the update); `CAST(? AS DECIMAL(14,4))` keeps exact decimal maths. |
| `services/billing/wallet.ts` (credit) | `SET balance = balance + x, "lowBalanceNotifiedAt" = CASE WHEN balance + x > …` | **MySQL evaluates SET left-to-right**: the CASE would see the *new* balance and add `x` twice. | Assign `lowBalanceNotifiedAt` first. Correct on MySQL, MariaDB and MariaDB `SIMULTANEOUS_ASSIGNMENT`. |
| `services/messaging/low-balance.ts` | `UPDATE … RETURNING …::text` | no RETURNING | conditional UPDATE, then read values if 1 row changed. |
| `lib/rate-limit.ts` | `INSERT … ON CONFLICT … DO UPDATE … RETURNING count` | different upsert syntax, no RETURNING | `INSERT … ON DUPLICATE KEY UPDATE` + `SELECT` in one transaction (same connection, row locked). |
| `services/billing/payments.ts`, `prisma/seed.ts` | `nextval('invoice_number_seq')` | no sequences | `UPDATE counters SET value = value + 1` + `SELECT` inside the payment transaction. Gap-free (PG sequences could leave gaps on rollback). |
| `services/messaging/delivery.ts` | `status::text`, `::uuid`, `FOR UPDATE` | casts | remove casts; `FOR UPDATE` works. |
| `services/messaging/compliance.ts` | `SELECT … FOR UPDATE` with `::uuid` | cast | remove cast. |
| `features/reports/queries.ts`, `features/admin/overview.ts`, `features/campaigns/service.ts` | `count(*) FILTER (WHERE …)`, `to_char(… AT TIME ZONE 'Asia/Dhaka', 'YYYY-MM-DD')`, `::text`, `::"MessageStatus"` | none exist in MySQL | `COUNT(CASE WHEN … THEN 1 END)`, `DATE_FORMAT(DATE_ADD(col, INTERVAL 6 HOUR), '%Y-%m-%d')` (Asia/Dhaka is fixed UTC+6, no DST; avoids needing time-zone tables, which shared hosting usually lacks), `CAST(… AS CHAR)`. |
| `features/contacts/service.ts` | `array_append`, `= ANY(tags)`, `unnest(tags)` | no arrays | `JSON_ARRAY_APPEND` / `JSON_CONTAINS`; distinct tags collected in application code (no `JSON_TABLE` on MariaDB < 10.6). |
| `app/admin/wallets/page.tsx` | `balance < "lowBalanceThreshold"` | **silent wrong result** (compares to a string) | backticks. |
| `tests/support/factories.ts` | `pg_tables`, `TRUNCATE … RESTART IDENTITY CASCADE` | PG catalogue | `information_schema.tables` + `FOREIGN_KEY_CHECKS=0` + `TRUNCATE`. |
| `app/api/health/route.ts` | `SELECT 1` | — | none. |

## 4. Prisma Client queries

| Finding | Location | Issue | Fix |
|---|---|---|---|
| `mode: "insensitive"` (8 uses) | admin/service, campaigns/service, contacts/service, templates/service, public/actions | Not supported by the MySQL connector (type error). | Drop `mode`. `utf8mb4_unicode_ci` `LIKE`/`=` are already case-insensitive → same behaviour. |
| `{ has: x }` list filters | contacts/service (`tags`), outbound-webhooks (`events`) | list filters don't exist for Json | `{ array_contains: [x] }` (Prisma JSON filter → `JSON_CONTAINS`). |
| Reading list fields | api-keys, dashboard/api page, contacts UI/export, pricing service, outbound webhooks | type becomes `JsonValue` | small `jsonStringArray()` helper at read sites. |
| `createMany({ skipDuplicates })` | several | → `INSERT IGNORE` on MySQL | Same semantics for our use (dedupe keys). `count` still reports inserted rows. |
| `$transaction` (interactive and batch, ~25 sites) | many | InnoDB default is REPEATABLE READ with gap locks; PG default is READ COMMITTED. | Pin every connection to READ COMMITTED (and UTC) via the driver's `initSql`, preserving PG semantics and lowering deadlock risk. |
| P2002 handling / `meta.target` | none found | `meta.target` shape differs per DB | no code depends on it. |
| `upsert`, `groupBy`, `aggregate`, `count`, cursor pagination | many | supported identically | none. |

## 5. Case sensitivity (behaviour differences to be aware of)

- **Unaffected:** emails, slugs (lower-cased on input), sender IDs (upper-cased), all token /
  session / API-key hashes (lower-case hex), API-key prefixes (lower-case).
- **Must stay case-sensitive** (externally generated identifiers where `abc` ≠ `ABC`):
  `messages.providerMessageId`, `payments.providerRef`, `message_events.dedupeKey`,
  `inbound_webhook_events.eventKey`, `idempotency_keys.key`. On a CI collation a provider ID
  that differs only by case would violate a unique index or match the wrong message. These
  columns get `utf8mb4_bin` in the migration SQL (Prisma does not track collation, so this
  causes no drift).
- **Accepted difference:** contact-group names (`@@unique([organizationId, name])`) and
  blocklist values become case-insensitively unique ("VIP" and "vip" can no longer coexist).
  Search (`contains`) stays case-insensitive as before.

## 6. Other checks

| Area | Finding |
|---|---|
| Full-text search | None. Search is `contains` (`LIKE %…%`). |
| JSON path filters | None. |
| Auth / sessions | DB-backed (`sessions`, `verification_tokens`), hashed tokens, looked up by unique hash. Portable. |
| Tenant isolation | Every tenant query filters `organizationId`; raw SQL keeps the same predicates. |
| Rate limiting | DB-backed (no Redis). Ported. |
| Money | `Decimal` end to end; raw SQL now casts to `DECIMAL(14,4)` (never DOUBLE). |
| Date/time | Stored UTC. Day buckets computed at +06:00. Session pinned to `+00:00` so `CURRENT_TIMESTAMP(3)` defaults match Prisma's UTC writes. |
| Secrets | `DATABASE_URL` and all secrets are read only in server modules (`src/lib/db.ts`, `src/config/env.ts`, services). No `NEXT_PUBLIC_*` secret. Logger redacts password/token/secret/authorization fields. |
| Errors | API handler and server actions log full errors server-side and return generic messages (`INTERNAL_ERROR` / "Something went wrong"); Prisma/SQL errors are never forwarded. Unchanged. |

## 7. Hostinger runtime requirements

| Requirement | Used by this app? | Business web hosting | VPS |
|---|---|---|---|
| Node.js runtime (Next.js server mode) | Yes | **Yes** — Business and Cloud plans run Node.js apps (Node 18/20/22/24), Next.js built as standalone ([docs](https://docs.hostinger.com/node.js/creating-an-app), [Next.js](https://docs.hostinger.com/node.js/overview-1/next)) | Yes |
| MySQL-compatible DB | Yes | **Yes** (MariaDB) | Yes (any) |
| Persistent background worker (`npm run worker`, `WORKER_IN_PROCESS`) | Optional | **Not documented** — Hostinger manages the app process; don't depend on it | Yes (systemd / pm2) |
| Cron | Yes (worker tick, housekeeping) | **Yes** — custom commands (`curl`/`wget`), unlimited jobs on Premium and above ([limits](https://www.hostinger.com/support/1583765-how-many-cron-jobs-can-you-set-up-in-hostinger/)). Check the shortest allowed interval in hPanel. | Yes |
| Redis | No | n/a | n/a |
| WebSockets | No | n/a | n/a |
| Queue processing | Yes — DB-backed queue (`messages.status = QUEUED`, leases) | Yes, driven by cron | Yes, continuous worker |
| File storage | Sender-ID documents, CSV imports, dev mailbox (`LOCAL_DATA_DIR`) or S3 | Local disk works only if `LOCAL_DATA_DIR` is an absolute path **outside** the deployment folder, which is replaced on redeploy. S3-compatible storage recommended. | Yes |
| Long-running requests | CSV import (≤10 MB), campaign launch (bulk insert) | Proxy timeouts not documented; worker tick now has a time budget | Yes |

## 8. SMS pipeline (already asynchronous)

The required flow already exists and is kept:

```
create campaign (DRAFT/SCHEDULED) ─► launchCampaign (worker) resolves audience,
  stores campaign_recipients + messages(status=QUEUED), debits wallet in one transaction
─► claimQueuedMessages (lease: lockedUntil, attempts) ─► dispatchMessages → provider
─► applyStatusUpdate: SUBMITTED + providerMessageId + message_events
─► delivery webhook /api/v1/webhooks/sms/[provider] (stored in inbound_webhook_events,
   idempotent) or polling ─► DELIVERED/FAILED, refunds, customer webhooks
```

Campaigns are never sent inside the HTTP request: the dashboard action only schedules them,
and only ≤200-message API sends get an opportunistic `after()` dispatch (the worker still
picks them up if that fails). On Hostinger Business the queue is driven by the cron-invoked
`POST /api/internal/worker/tick`.

## 9. Migration outcome

### Schema changes (`prisma/schema.prisma`)

- `provider = "mysql"`; connection URL stays in `prisma.config.ts` (`env("DATABASE_URL")`).
- All `@db.Uuid` → `@db.Char(36)`.
- `String[]` → `Json` (`@default("[]")` where there was a default): `Contact.tags`,
  `ApiKey.scopes`, `ApiKey.ipAllowlist`, `WebhookEndpoint.events`, `PricingPlan.features`.
  Read with `jsonStringArray()` (`src/lib/utils.ts`).
- 75 string columns sized explicitly: `@db.Text` for free text (bodies, messages, descriptions,
  notes, user agents, URLs, API log paths), `@db.VarChar(254)` for emails, `VarChar(255/500/512)`
  for external identifiers and keys (idempotency key 255, provider event/dedupe keys 512).
- New model `Counter` (`counters` table) replacing the invoice sequence.
- Nothing removed: all 42 models, relations, indexes and unique constraints are preserved.

### Migrations

- `prisma/migrations/20260930000000_init_mysql`: generated baseline plus hand-written SQL
  (`utf8mb4_bin` on 5 case-sensitive identifier columns, both CHECK constraints, counter seed
  `invoice_number = 1000` so numbering continues at 1001 as before).
- PostgreSQL migrations removed from the tree (they remain in git history before this change; they cannot run on MySQL).
- **Verified:** `prisma migrate deploy` on an empty MariaDB 10.4 applies cleanly, and
  `prisma migrate diff --from-config-datasource --to-schema` reports an empty migration (no drift).

### Code changes

| Area | Files |
|---|---|
| Driver adapter, READ COMMITTED + UTC session, deadlock retry | `src/lib/db.ts`, `package.json` (`@prisma/adapter-mariadb`, `mariadb` 3.4.5 pinned to the adapter's version; removed `@prisma/adapter-pg`, `pg`, `@types/pg`, `embedded-postgres`) |
| Queue claim (portable, deadlock-safe) | `src/services/messaging/dispatcher.ts` |
| Delivery transaction retry, casts | `src/services/messaging/delivery.ts`, `compliance.ts`, `low-balance.ts`, `outbound-webhooks.ts` |
| Wallet ledger | `src/services/billing/wallet.ts` |
| Invoice counter | `src/services/billing/counters.ts` (new), `payments.ts`, `prisma/seed.ts` |
| Rate limiter | `src/lib/rate-limit.ts` |
| Reports / dashboards | `src/lib/sql.ts` (new), `src/features/reports/queries.ts`, `features/admin/overview.ts`, `features/campaigns/service.ts`, `app/admin/wallets/page.tsx` |
| JSON lists | `features/contacts/service.ts`, `lib/api/api-keys.ts`, `services/billing/pricing.ts`, `app/dashboard/api/page.tsx`, `app/dashboard/api/webhooks/page.tsx`, `app/dashboard/contacts/page.tsx`, `app/admin/pricing/page.tsx` |
| `mode: "insensitive"` removed | `features/admin/service.ts`, `campaigns/service.ts`, `contacts/service.ts`, `templates/service.ts`, `public/actions.ts` |
| Hostinger cron tick time budget | `services/messaging/worker.ts`, `app/api/internal/worker/tick/route.ts` |
| Config | `src/config/env.ts` (requires `mysql://`), `next.config.ts`, `.env.example`, `docker-compose.yml`, `Dockerfile` |
| Scripts | `build:deploy` added; `db:reset` guarded by `scripts/guard-local-db.mjs`; `db:local` and `scripts/local-db.mjs` (embedded PostgreSQL) removed |
| Tests | `tests/support/factories.ts`, `global-setup.ts`, `vitest.config.mts`, new `tests/integration/mysql-portability.test.ts` |
| Docs | this file, `07-hostinger-deployment.md`, `04-deployment.md`, `02-architecture.md`, `README.md` |

### Verification (MariaDB 10.4.32)

- `tsc --noEmit`, `eslint`, `next build`: pass.
- Unit + integration tests: **139/139 pass**, including 9 new portability tests (concurrent
  claims never overlap, claims racing delivery updates without deadlock errors, exact rate-limit
  counting under concurrency, exact decimal balances and SET ordering, gap-free concurrent
  invoice numbers, JSON tags, case-sensitive provider IDs, Asia/Dhaka day buckets).
- Production build smoke test over HTTP: all dashboard and admin pages render (200) with seeded
  data; login/session; API bulk send (500 recipients), idempotent replay; 3 concurrent cron ticks
  plus the in-process worker processed 800 messages with every message claimed exactly once
  (`attempts = 1`), zero duplicate submissions, provider message IDs stored, delivery statuses
  applied; no server errors logged.
- Found and fixed during the smoke test: an InnoDB deadlock (error 1213) between the queue
  claim and delivery updates, which PostgreSQL never produced (it does not lock index entries).

### Not covered

- **Existing PostgreSQL data.** This migration creates a new, empty MySQL schema. Copying live
  data from a PostgreSQL database needs a separate one-off export/import (tables are
  identical in shape; list columns become JSON arrays, UUIDs become CHAR(36)).
- Playwright E2E suite was not run.
