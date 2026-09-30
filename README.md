# SMSFlow BD

A multi-tenant bulk SMS platform for businesses in Bangladesh. It covers:
- transactional, promotional and bulk messaging, with Bangla (Unicode) segment pricing
- contacts and campaigns
- a prepaid wallet with VAT invoices
- sender-ID approval
- a REST API with idempotency and signed webhooks
- an operator admin console.

> **What this is, honestly.** The application is complete and tested end to end with the **mock**
> SMS and payment providers. Real message delivery and online payments need a provider
> contract and an adapter review; see [docs/05-integrations.md](docs/05-integrations.md). The
> `http` SMS adapter, the SSLCommerz adapter and the `http` email adapter are **unverified** and
> labelled as such in the UI. Prices in the seed are **examples** that you can edit in Admin → Pricing.
> Contact details are placeholders. The platform makes no claims about regulatory approval,
> operator relationships or delivery rates.

## Stack

- Next.js 16 (App Router, Server Actions)
- React 19, TypeScript, Tailwind CSS 4, Radix-based UI components
- MySQL 8+ / MariaDB 10.4+ with Prisma 7 (`@prisma/adapter-mariadb`), Zod
- Recharts
- Argon2id; pino logging
- Vitest (unit and integration tests), Playwright (E2E tests)

## Quick start (local)

Requirements: Node.js 22.9 or later and a MySQL 8+ or MariaDB 10.4+ server (XAMPP's MariaDB, a local install,
or `docker run -d -p 3306:3306 -e MARIADB_ROOT_PASSWORD=root mariadb:11.4`).

```bash
npm install
cp .env.example .env
```

Then fill in the four secrets in `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Create the databases and a user once (as the MySQL root user):

```sql
CREATE DATABASE smsflow CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE smsflow_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'smsflow'@'localhost' IDENTIFIED BY 'smsflow';
GRANT ALL PRIVILEGES ON smsflow.* TO 'smsflow'@'localhost';
GRANT ALL PRIVILEGES ON smsflow_test.* TO 'smsflow'@'localhost';
```

`prisma migrate dev` additionally needs permission to create a temporary shadow database
(`GRANT CREATE, DROP ON *.* TO 'smsflow'@'localhost'` on a development machine only).

```bash
npm run db:deploy      # apply migrations
npm run db:seed        # fictional demo data (development only)
npm run dev            # http://localhost:3000
```

Set `WORKER_IN_PROCESS=true` in `.env` to run the background worker inside the dev server, or run
`npm run worker` in another terminal.

**Demo sign-ins** are listed at the top of [`prisma/seed.ts`](prisma/seed.ts). They cover a platform admin, an
organization owner, a manager and a developer. The demo data is fictional, and those credentials must never be used outside
local development.

**Local conveniences**
- Emails (verification, password reset, receipts) are written to `.local/mailbox/*.html` instead of being sent.
- The mock SMS provider delivers after a few seconds. Numbers ending in `0000`, `8888` or `9999`
  simulate a rejection, a temporary error and a delivery failure respectively.
- The mock payment gateway has a checkout page with success, failure and cancel buttons.

## Scripts

| Script | What it does |
|---|---|
| `dev` / `build` / `start` | Development server, production build (standalone), run the production build |
| `build:deploy` | `prisma generate` + `prisma migrate deploy` + `next build` (deployment build command) |
| `worker` | Background worker: campaigns, send queue, retries, delivery polling, webhooks, housekeeping |
| `db:migrate` / `db:deploy` | Create a migration (dev) / apply migrations (prod) |
| `db:bootstrap` | Idempotent production setup: permissions, example pricing, optional first super admin |
| `db:seed` / `db:reset` | Demo data / wipe and re-migrate (development only; `db:reset` refuses non-local databases) |
| `lint` / `typecheck` | ESLint / TypeScript |
| `test:unit` | Unit tests, no database |
| `test:integration` | Services and API route handlers against a real MySQL/MariaDB database (`TEST_DATABASE_URL`, which must contain "test") |
| `test:e2e` | Playwright customer journey against a production build (`npm run build` first) |

The integration tests create their own schema through migrations in `smsflow_test` (created above).

## Project layout

```
src/app/            routes: (marketing), (auth), dashboard, admin, api/v1
src/features/       domain modules (service + actions + components per feature)
src/services/       messaging pipeline, billing, and provider abstractions (sms, payments, email, storage)
src/lib/            auth, API handler, crypto, rate limiting, phone/segment/money utilities
src/components/     UI kit and shared, marketing, dashboard and admin components
prisma/             schema, migrations (MySQL), archived PostgreSQL migrations, demo seed
scripts/            worker, bootstrap, standalone start, local-DB guard
tests/              unit, integration, e2e, support
docs/               product analysis, architecture, design system, deployment, integrations,
                    MySQL migration audit, Hostinger deployment guide
```

## Documentation

1. [Product analysis](docs/01-product-analysis.md): market reference review and product decisions
2. [Architecture](docs/02-architecture.md): tenancy, RBAC, the messaging pipeline, billing, security
3. [Design system](docs/03-design-system.md): tokens, components, charts, accessibility
4. [Deployment and operations](docs/04-deployment.md): Docker, configuration, backups, monitoring
5. [Integrations](docs/05-integrations.md): provider interfaces and the replacement guide

The public API reference is served by the app at `/docs`.

## Before going live

Work through the checklists in [docs/04-deployment.md](docs/04-deployment.md#7-security-checklist-before-launch) and
[docs/05-integrations.md](docs/05-integrations.md#5-verification-checklist-before-setting-verified--true).
In particular:
- connect and verify a real SMS provider
- replace the example pricing and placeholder contact details
- have the legal pages reviewed
- confirm that your sender-ID and content policies match current BTRC and operator rules.
