# 07 · Deploying on Hostinger (Business web hosting)

This guide deploys SMSFlow BD as a **Hostinger Node.js web app** with a **Hostinger MariaDB**
database and **cron-driven background processing**. It needs no Vercel and no Docker. For a VPS,
use [04-deployment](04-deployment.md) (Docker Compose or `npm run start` + `npm run worker`).

What Hostinger documents, and this guide relies on:

- Node.js web apps are available on **Business web hosting** and Cloud plans; deploy from
  **GitHub** or a `.zip`/`.tar.gz` upload; Node **18, 20, 22, 24**; build command, output directory
  and environment variables are set in hPanel; build and runtime logs are shown in hPanel
  ([Creating a Node.js app](https://docs.hostinger.com/node.js/creating-an-app)).
- Next.js runs in server mode: Hostinger builds with `output: "standalone"` and starts the
  bundled server itself. It needs Node 20+ and a config that exports an object
  ([Next.js on Hostinger](https://docs.hostinger.com/node.js/overview-1/next)). This project
  already uses a `next.config.ts` object with `output: "standalone"`.
- Web and Cloud plans use **MariaDB** on port 3306
  ([which DBMS](https://www.hostinger.com/support/1583226-which-database-management-system-is-used-at-hostinger/)).
- Cron jobs can run custom commands, with unlimited jobs on Premium and above
  ([cron limits](https://www.hostinger.com/support/1583765-how-many-cron-jobs-can-you-set-up-in-hostinger/),
  [cron docs](https://docs.hostinger.com/websites/cron-jobs)).

What Hostinger does **not** document, so this guide does not rely on it: always-on background
processes, request timeouts, memory limits, and the shortest cron interval your plan allows.
Check those in your own hPanel before launch (see [Limitations](#limitations)).

---

## 1. Create the MySQL (MariaDB) database

hPanel → your site → **Databases** (MySQL Databases / Management):

1. Enter a database name and a database user name (Hostinger prefixes both with your account
   id, e.g. `u123456789_smsflow`).
2. Generate a strong password. Avoid `@ : / ? #` or URL-encode them in `DATABASE_URL` (step 4).
3. Create. Note the full database name, user name and password.

The migrations create every table as `utf8mb4 / utf8mb4_unicode_ci`, so Bangla text is stored
correctly regardless of the database default.

## 2. The database user

Hostinger creates the user together with the database and grants it full rights on that
database, which is what `prisma migrate deploy` needs (CREATE/ALTER/INDEX/REFERENCES).
The app never needs rights on any other database. Do **not** run `prisma migrate dev` or
`prisma migrate reset` against it: both are for development (`npm run db:reset` refuses to
run against a non-local host).

## 3. Database hostname

In **Databases → Management**, open the database's details. Use the host shown there.
For an app on the same hosting account this is normally `localhost`.

To run commands from your own computer (step 8 option B, backups), enable **Remote MySQL** for
your IP address in hPanel and use the remote hostname it shows. Remove the IP again when done.

## 4. Configure `DATABASE_URL`

```
DATABASE_URL=mysql://u123456789_smsflow:YOUR_PASSWORD@localhost:3306/u123456789_smsflow
```

- Scheme must be `mysql://` (the app validates this at startup).
- URL-encode special characters in the password: `node -e "console.log(encodeURIComponent('p@ss:w/rd'))"`.
- `DATABASE_URL` is read only by server code (`src/lib/db.ts`, `prisma.config.ts`). Never create a
  `NEXT_PUBLIC_` copy of it.
- Keep `DATABASE_POOL_SIZE` small (5). Shared MariaDB limits connections per user, and each
  running Node process opens its own pool.

## 5. Other environment variables

hPanel → your Node.js app → **Settings / Environment variables**. Values are available at build
time and at runtime. Generate each secret with
`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `APP_URL` | `https://your-domain.com` (used in links, canonical URLs and the sitemap; set before building) |
| `DATABASE_URL` | step 4 |
| `DATABASE_POOL_SIZE` | `5` |
| `AUTH_SECRET`, `API_KEY_PEPPER`, `SETTINGS_ENCRYPTION_KEY`, `CRON_SECRET` | unique random values; keep a copy in a password manager (see [Backups](#15-backups)) |
| `WORKER_IN_PROCESS` | `false` (background work runs from cron, step 13) |
| `WORKER_TICK_BUDGET_MS` | `45000` |
| `SMS_PROVIDER` | `automas` (see [05-integrations](05-integrations.md#the-automas-adapter)); `mock` sends nothing |
| `SMS_PROVIDER_API_KEY` | your Automas API key |
| `SMS_DEFAULT_SENDER_ID` | a sender ID approved on your Automas account |
| `EMAIL_PROVIDER` + `EMAIL_*` | `http` provider for real email; `console` only writes files |
| `STORAGE_PROVIDER` | `s3` recommended (below) |
| `STORAGE_S3_*` | S3-compatible bucket (AWS S3, Cloudflare R2, …) |
| `LOCAL_DATA_DIR` | only if `STORAGE_PROVIDER=local`: an absolute path **outside** the app folder, e.g. `/home/u123456789/smsflow-data` |
| `PAYMENT_PROVIDERS` | e.g. `manual` or `manual,sslcommerz`; never `mock` on a live site |
| `LOG_LEVEL` | `info` |

**File storage.** Hostinger deploys the built app into `~/domains/<domain>/hbuilds/current/nodejs`
and replaces it on each deploy, so files written inside the app folder can be lost. Use
`STORAGE_PROVIDER=s3`, or point `LOCAL_DATA_DIR` at an absolute path in your home directory.

## 6. Install Node dependencies

In the Node.js app setup choose **Node.js 24** (`package.json` requires 24.x) and **npm**.
Hostinger runs the install step itself. `npm install` triggers `postinstall` → `prisma generate`.

The build needs the dev dependencies (TypeScript, Tailwind, Prisma CLI). If a build log shows
`prisma: not found` or missing `typescript`, the platform installed production dependencies
only; contact Hostinger support to confirm how to install dev dependencies for the build.

## 7. Prisma generate

Runs automatically in `postinstall` and again in the build scripts. Nothing to configure.

## 8. Prisma migrate deploy

Always `prisma migrate deploy` for production. Never `migrate reset` or `migrate dev`, and never
edit an applied migration. Pick one option:

**Option A (recommended): during the build.** Set the build command to:

```
npm run build:deploy
```

which runs `prisma generate && prisma migrate deploy && next build --webpack`. It needs `DATABASE_URL` at
build time (documented) and the database reachable from Hostinger's build environment. On the
first deploy check the build log for `All migrations have been successfully applied.` If the
build log shows `P1001: Can't reach database server`, use option B and set the build command to
`npm run build`.

**Option B: from your computer**, with Remote MySQL enabled for your IP (step 3):

```bash
DATABASE_URL="mysql://USER:PASSWORD@REMOTE_HOST:3306/DBNAME" npx prisma migrate deploy
```

Run this **before** deploying app code that needs the new migration.

**First deployment only**: create the permission catalogue, example pricing and your first
super admin (idempotent, safe to repeat), from your computer with the same `DATABASE_URL` and the
same `AUTH_SECRET`, `API_KEY_PEPPER`, `SETTINGS_ENCRYPTION_KEY` as production:

```bash
BOOTSTRAP_ADMIN_EMAIL=you@your-company.com npm run db:bootstrap
```

It prints a one-time password to your terminal. Sign in and change it immediately.

## 9. Build Next.js

In the app's build settings:

| Setting | Value |
|---|---|
| Framework preset | Next.js (auto-detected) |
| Build command | `npm run build:deploy` (option A) or `npm run build` |
| Output directory | `.next` |
| Node.js version | 22 |

## 10. Start Next.js

Hostinger starts the standalone server it built. You do not configure `npm run start`
(that script is for VPS / self-hosting). After deploy, open `https://your-domain.com/api/health`;
it should return `{"status":"ok","database":"ok",...}`.

## 11. Domain

Deploy the app to the domain in hPanel. Hostinger requires removing an existing website from a
domain before deploying a Node.js app to it. Set `APP_URL` to the final `https://` origin and
redeploy if you change domains (static marketing pages bake it in).

## 12. SSL

Enable the free SSL certificate for the domain in hPanel's **SSL** section and turn on forced HTTPS.
The app requires HTTPS in production: it sets HSTS, `upgrade-insecure-requests`, and `Secure`,
`__Host-` session cookies, so sign-in does not work over plain HTTP.

## 13. Cron jobs (background processing)

All background work (launching scheduled campaigns, sending the queue, retries, delivery polling,
customer webhooks, housekeeping) runs in `POST /api/internal/worker/tick`, protected by
`CRON_SECRET`. Call it every minute.

Because the command needs a header with special characters, put it in a script (Hostinger's
cron form does not accept special characters directly for PHP jobs; a `.sh` file works for all):

`/home/u123456789/cron/smsflow-tick.sh`

```sh
#!/bin/sh
curl -sS -m 55 -X POST \
  -H "Authorization: Bearer PASTE_CRON_SECRET_HERE" \
  https://your-domain.com/api/internal/worker/tick \
  >> /home/u123456789/cron/smsflow-tick.log 2>&1
echo >> /home/u123456789/cron/smsflow-tick.log
```

- Make it private: File Manager → permissions `700` (it contains a secret; it lives outside
  `public_html`).
- hPanel → **Cron Jobs** (under Advanced) → **Custom**: command `sh /home/u123456789/cron/smsflow-tick.sh`,
  schedule every minute (`* * * * *`). If your plan offers only longer intervals, use the shortest
  one available and see the throughput notes below.
- The log grows; truncate it occasionally (or drop the `>>` redirect once everything works).

Each tick claims at most 20 batches of 100 messages and stops claiming after
`WORKER_TICK_BUDGET_MS`, so one tick sends roughly up to 2,000 messages depending on your SMS
gateway's latency. Overlapping ticks are safe: messages are claimed with row locks and a lease,
so none is sent twice. Small API sends (≤200 messages) are also dispatched right after the API
response, so they don't wait for cron.

## 14. Logs

- **Build logs**: hPanel → the app → Deployments.
- **Runtime logs**: hPanel → the app → logs (stdout/stderr). The app writes structured JSON
  (pino). Passwords, tokens, secrets and `authorization` headers are redacted; phone numbers are
  masked. Users only ever see generic errors; the detailed error (including Prisma/SQL errors)
  is in these logs with a `requestId` matching the API response.
- **Cron**: the `smsflow-tick.log` file from step 13.
- **Health**: `GET /api/health` reports DB connectivity and the number of messages stuck in the queue.
  Point an uptime monitor at it.

## 15. Backups

- Hostinger's own backups (hPanel **Backups** section) cover files and databases on its
  schedule. Also keep **your own** off-site copies: the database holds wallets, the ledger and
  invoices.
- Keep a separate, secure copy of `AUTH_SECRET`, `API_KEY_PEPPER`, `SETTINGS_ENCRYPTION_KEY`.
  Without `SETTINGS_ENCRYPTION_KEY`, encrypted provider credentials in a backup are unreadable;
  without `API_KEY_PEPPER`, every customer API key stops working.
- With `STORAGE_PROVIDER=s3`, enable versioning on the bucket.

## 16. Database backup and restore

**Backup** (from your computer, Remote MySQL enabled; or phpMyAdmin → Export → SQL):

```bash
mysqldump -h REMOTE_HOST -u USER -p --single-transaction --routines --triggers --no-tablespaces DBNAME \
  | gzip > smsflow-$(date +%F).sql.gz
```

`--single-transaction` gives a consistent snapshot without locking tables. `mariadb-dump` works the same.

**Restore** into an **empty** database (create a new one in hPanel for a restore test; never
restore over the live database while the app is running):

```bash
gunzip -c smsflow-YYYY-MM-DD.sql.gz | mysql -h REMOTE_HOST -u USER -p NEW_DBNAME
```

The dump includes `_prisma_migrations`, so `prisma migrate deploy` continues from the right
point afterwards. After restoring, run the wallet integrity check from
[04-deployment §5](04-deployment.md#5-backups-and-restore) (expect zero rows).

## 17. Updating the application from GitHub

1. Develop locally; create migrations with `npm run db:migrate` (on your local database).
2. Run `npm run typecheck`, `npm run lint`, `npm test`.
3. Commit (including `prisma/migrations/*`) and push to the branch connected in hPanel.
4. Hostinger rebuilds automatically. With option A the new migrations are applied during the
   build; with option B, run `npx prisma migrate deploy` against production **before** pushing.
5. Check the build log, then `/api/health`, then the cron log.

Migrations must stay backward compatible for one release (add columns as nullable or with
defaults; drop old columns in a later release), because the old version keeps serving until the
new build is live.

---

## Limitations

| Topic | On Hostinger Business web hosting |
|---|---|
| Background worker (`npm run worker`) | Not used. Always-on processes are not documented for managed Node.js apps. Cron + tick endpoint instead. |
| `WORKER_IN_PROCESS=true` | Don't use: it depends on the web process staying up, which you don't control. |
| Queue latency | Up to the cron interval (1 minute at best) for campaigns and retries. |
| Throughput | Roughly ≤ 2,000 messages per tick, bounded by gateway latency and `WORKER_TICK_BUDGET_MS`. Large campaigns take several minutes. |
| Request timeouts, memory, CPU | Not published. Large CSV imports (the app allows 10 MB) and launching very large campaigns run inside a request; test your largest expected import and campaign in staging. |
| Database connections | Shared MariaDB limits connections per user; keep `DATABASE_POOL_SIZE` small. |
| Local file storage | App folder is replaced on deploy; use S3 or an absolute `LOCAL_DATA_DIR`. |
| Redis / WebSockets | Not required by this app. |
| MariaDB version | Not published. The app is tested on MariaDB 10.4 and works on 10.4+ and MySQL 8+. Check the version in phpMyAdmin. |

## When to move to a VPS

Move to a VPS (see [04-deployment](04-deployment.md)) when any of these apply:

- You need sub-minute delivery for campaigns or more than a few thousand messages per minute:
  a VPS runs `npm run worker` continuously (every 2 s) and can run several workers in parallel.
- Campaigns of hundreds of thousands of recipients, or CSV imports close to the limits, hit
  request timeouts.
- You need guaranteed CPU/RAM, more database connections, or your own MariaDB tuning.
- You need process supervision (systemd/pm2), Docker, or Redis later on.

## Recommended production architecture

**Starting out (Hostinger Business)**

```
Browser / API clients ──HTTPS──► Hostinger Node.js app (Next.js standalone)
                                   │  API routes, server actions, webhooks
                                   ▼
                               Hostinger MariaDB  ◄── cron (every minute)
                                   ▲                   POST /api/internal/worker/tick
SMS gateway ──delivery webhooks──┘                   (campaigns, queue, retries, polling)
S3-compatible bucket ◄── sender-ID documents, CSV uploads
```

**Growing (VPS)**: the same code, with `docker compose` (MariaDB, web, one or more `worker`
containers, a migrate job) behind a TLS reverse proxy, managed backups, and the tick endpoint no
longer needed.
