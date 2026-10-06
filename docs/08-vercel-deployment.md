# 08 · Deploying on Vercel (remote MySQL)

Next.js + Prisma 7 + MySQL 8.0+ / MariaDB 10.4+ on Vercel. The database is a remote MySQL server
(any provider); Vercel only runs the web app.

## How the build works

```
npm install          (Vercel install step, devDependencies included)
  └─ postinstall: prisma generate      → src/generated/prisma (no database connection)
npm run build        = prisma generate && next build --webpack   (see "Why Webpack" below)
```

- `prisma generate` and `next build` **do not need a database**. `prisma.config.ts` reads
  `DATABASE_URL` without requiring it, and the Prisma client is created on first query, not on import.
  If the database is unreachable during the build, marketing pages fall back to built-in defaults
  (logged as warnings) and refresh from the database at runtime.
- Migrations are **not** part of the Vercel build. Run them deliberately (below), so a failed or
  preview build can never change the production schema.
- Prisma runs through the `@prisma/adapter-mariadb` driver adapter (no query-engine binary), in the
  Node.js runtime. `src/proxy.ts` does not touch the database.

### Why Webpack for production builds

`next dev` uses Turbopack; `next build` uses Webpack (`--webpack`). Turbopack runs PostCSS/Tailwind
for `globals.css` in child Node processes that connect back to the build over a 127.0.0.1 TCP
socket. Build runners that block loopback connections (seen on Hostinger) make those workers exit
with status 0 before connecting, failing the build. Turbopack's in-process alternative
(`experimental.turbopackPluginRuntimeStrategy: "workerThreads"`) built the app but crashed the
process on exit (segfault, exit 139) on Node 24 with Next 16.3.8, so it is not used. Webpack runs
PostCSS in-process and produces the same CSS. Revisit when a stable Next release fixes either path.

## 1. Vercel project settings

| Setting | Value |
|---|---|
| Framework preset | Next.js |
| Install command | default (`npm install`) |
| Build command | default (`npm run build`) |
| Node.js version | 24.x |

## 2. Environment variables (Project → Settings → Environment Variables)

Required (Production; repeat for Preview with a **separate** staging database):

| Name | Value |
|---|---|
| `APP_URL` | `https://YOUR-DOMAIN.com` |
| `DEFAULT_LOCALE` | `en` |
| `DATABASE_URL` | `mysql://PRODUCTION_USER:PRODUCTION_PASSWORD@PRODUCTION_HOST:3306/PRODUCTION_DATABASE` (append `?ssl=true` if the server requires TLS; URL-encode special characters in the password) |
| `DATABASE_POOL_SIZE` | `2` (each function instance has its own pool) |
| `AUTH_SECRET` | 32+ random bytes |
| `API_KEY_PEPPER` | 32+ random bytes |
| `SETTINGS_ENCRYPTION_KEY` | 32 random bytes, base64 |
| `CRON_SECRET` | random string, 16+ characters |
| `STORAGE_PROVIDER` | `s3` (Vercel has no persistent disk), plus the `STORAGE_S3_*` values |
| `EMAIL_PROVIDER` | `http`, plus `EMAIL_PROVIDER_URL`, `EMAIL_PROVIDER_KEY`, `EMAIL_FROM` |
| `SMS_PROVIDER` | `http` with a reviewed adapter (`mock` sends nothing), plus `SMS_PROVIDER_*` |
| `PAYMENT_PROVIDERS` | e.g. `manual` or `manual,sslcommerz`, plus `PAYMENT_PROVIDER_*` |
| `WORKER_IN_PROCESS` | `false` |

Generate secrets with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.

**Do not set `NODE_ENV`.** Vercel sets it. `NODE_ENV=production` during install makes npm skip
devDependencies that the build needs. Do not set `TEST_DATABASE_URL` either; it is for the
integration tests only.

The MySQL server must accept connections from Vercel (Vercel functions have no fixed IPs unless
you use Secure Compute). Allow remote access for the database user accordingly.

## 3. Create / migrate the production database

From a trusted machine with the repository checked out and `npm install` done:

```bash
DATABASE_URL='mysql://PRODUCTION_USER:PRODUCTION_PASSWORD@PRODUCTION_HOST:3306/PRODUCTION_DATABASE' npx prisma migrate deploy
DATABASE_URL='mysql://PRODUCTION_USER:PRODUCTION_PASSWORD@PRODUCTION_HOST:3306/PRODUCTION_DATABASE' BOOTSTRAP_ADMIN_EMAIL=ops@YOUR-DOMAIN.com npm run db:bootstrap
```

- `migrate deploy` applies only pending migrations from `prisma/migrations` and never drops data.
  On a new, empty database it creates every table (`20260930000000_init_mysql`).
- `db:bootstrap` is idempotent: permission catalogue, default pricing, and (optionally) the
  first super admin, whose one-time password is printed to your terminal.
- Never run `prisma migrate reset`, `prisma db push` or `npm run db:seed` against production.

Repeat `npx prisma migrate deploy` before (or right after) deploying a version that adds migrations.

## 4. Background processing

Vercel has no long-running worker. Have a scheduler call the worker tick every minute with
`Authorization: Bearer <CRON_SECRET>` (GET or POST `https://YOUR-DOMAIN.com/api/internal/worker/tick`).

- Vercel Cron (Pro plan; Hobby only allows daily jobs) sends that header automatically when
  `CRON_SECRET` is set. Add to `vercel.json`:
  `{ "crons": [{ "path": "/api/internal/worker/tick", "schedule": "* * * * *" }] }`
- Any external cron service works too.

Without it, campaigns, queued messages, retries, delivery polling and webhooks do not progress.
