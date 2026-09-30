# 04 · Deployment, operations, backups and monitoring

This guide covers running SMSFlow BD in production on a VPS or container host: the processes,
configuration, first deployment, upgrades, backups and monitoring. For Hostinger Business web
hosting (managed Node.js, no Docker), follow [07-hostinger-deployment](07-hostinger-deployment.md).

> **Status.** The Dockerfile and `docker-compose.yml` follow standard patterns, but they were
> written on a machine without Docker and **have not been built or run yet**. Build them in a
> staging environment first. The non-Docker path (`npm run build` → `npm run start` + `npm run worker`)
> was run locally with the E2E suite against it.

---

## 1. What runs in production

| Process | Command | Scales | Notes |
|---|---|---|---|
| **web** | `node server.js` (standalone build) or `npm run start` | Horizontally | Stateless apart from `LOCAL_DATA_DIR` (use S3 storage with several instances). |
| **worker** | `npm run worker` | Horizontally | Launches campaigns, dispatches the queue, retries, polls delivery, sends customer webhooks, housekeeping. All steps claim work with row locks plus a lease, or atomic conditional updates, so extra workers add throughput without double-sending. |
| **MySQL / MariaDB** | MySQL 8.0+ or MariaDB 10.4+ (compose uses MariaDB 11.4) | Primary + replicas | Tables are created as `utf8mb4` (Bangla content) by the migrations. |
| **migrate job** | `npx prisma migrate deploy && npm run db:bootstrap` | Once per deploy | Run before new web/worker versions start. |

Sessions, rate limits, idempotency keys and the queue all live in the database. There is no
Redis dependency. For very high throughput, see "Scaling" below.

**Serverless / no long-running processes.** Instead of the worker, call
`POST /api/internal/worker/tick` every minute with `Authorization: Bearer <CRON_SECRET>`.
This processes up to 20 batches per call. It has lower throughput and higher latency than a
dedicated worker; use it only for small deployments.

**Single small server.** `WORKER_IN_PROCESS=true` runs the worker loop inside the web process.
It is convenient, but only one web instance may run with it enabled, and web restarts pause sending.

---

## 2. Configuration

Every variable is documented in [`.env.example`](../.env.example). Production essentials:

| Variable | Requirement |
|---|---|
| `NODE_ENV` | `production` (set by the Docker image and `npm run start`). |
| `APP_URL` | Public HTTPS origin, e.g. `https://sms.example.com`. Also a **build argument**: static marketing pages bake it into canonical URLs and the sitemap. |
| `DATABASE_URL` | `mysql://USER:PASSWORD@HOST:3306/DATABASE`. Append `?ssl=true` for a remote server that requires TLS. URL-encode special characters in the password. |
| `AUTH_SECRET`, `API_KEY_PEPPER`, `SETTINGS_ENCRYPTION_KEY`, `CRON_SECRET` | Unique random values: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Store them in a secret manager. |
| `SMS_PROVIDER` | `http` with a reviewed adapter, or a new adapter (see [05-integrations](05-integrations.md)). `mock` sends nothing. |
| `EMAIL_PROVIDER` | `http` (or a new adapter). `console` only writes files to `LOCAL_DATA_DIR/mailbox`. |
| `STORAGE_PROVIDER` | `s3` for more than one web instance. `local` needs a persistent volume at `LOCAL_DATA_DIR`. |
| `PAYMENT_PROVIDERS` | E.g. `manual` or `manual,sslcommerz`. `mock` is disabled in production builds unless `ALLOW_MOCK_PAYMENTS=true`, **which must never be set on a live site**. |
| `WORKER_IN_PROCESS` | `false` when running the worker separately. |

**Secret rotation caveats**
- `API_KEY_PEPPER`: changing it invalidates every customer API key.
- `SETTINGS_ENCRYPTION_KEY`: provider secrets saved in Admin → Settings are encrypted with it.
  Before rotating, re-enter those secrets. Otherwise they can no longer be decrypted, and the env fallbacks are used.
- `AUTH_SECRET`: rotating it is safe; sessions are stored in the database as hashes.

Provider credentials can live either in env vars or in **Admin → Settings**, where they are
encrypted with AES-256-GCM and never sent back to the browser. Database settings take precedence.

---

## 3. First deployment

### With Docker Compose (single host)

```bash
cp .env.example .env.production        # fill in real values; keep this file out of git
# .env.production also needs: MYSQL_PASSWORD, MYSQL_ROOT_PASSWORD, APP_URL, optionally BOOTSTRAP_ADMIN_EMAIL
docker compose --env-file .env.production up -d --build
docker compose logs migrate            # shows the one-time admin password if BOOTSTRAP_ADMIN_EMAIL was set
```

Then put a TLS-terminating reverse proxy in front of `127.0.0.1:3000`. A minimal Caddy example:

```
sms.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

The proxy must pass `X-Forwarded-For`, and must be the only way to reach the app. Per-IP rate
limits trust the first `X-Forwarded-For` hop.

### Without Docker

```bash
npm ci
npm run build                           # APP_URL must be set at build time
npx prisma migrate deploy
BOOTSTRAP_ADMIN_EMAIL=ops@example.com npm run db:bootstrap
npm run start                           # web (PORT, default 3000)
npm run worker                          # in a separate service (systemd, pm2, ...)
```

### After the first deploy

1. Sign in as the bootstrap admin and **change the one-time password**.
2. Admin → Settings: configure the SMS provider, the payment providers and manual-payment
   instructions, and the platform limits. Send test messages to your own numbers and confirm
   delivery reports arrive (`/api/v1/webhooks/sms/<provider>`).
3. Admin → Pricing: replace the **example** plans and packages with your real prices.
4. Replace placeholder contact details in `src/config/site.ts` and have the legal pages
   (`/terms`, `/privacy`, `/refund-policy`) reviewed by counsel before launch.
5. Never run `npm run db:seed` in production. It creates demo accounts with a public password,
   and it refuses to run unless `SEED_ALLOW_DEMO=true`.

---

## 4. Upgrades and migrations

1. Back up the database (below).
2. Build the new images or build.
3. Run the migrate job: `docker compose run --rm migrate`, or `npx prisma migrate deploy`.
4. Restart web, then the workers. Workers finish their current tick on `SIGTERM`
   (`stop_grace_period: 30s`). Messages claimed by a worker that died are re-claimed after their short lease expires.

Migration rules for contributors:
- Create migrations with `npm run db:migrate` in development and commit `prisma/migrations/*`.
- Prefer **expand → migrate → contract**: add columns as nullable or with defaults, deploy, backfill,
  then tighten constraints in a later release. This keeps old and new app versions working
  during a rolling deploy.
- Never edit an applied migration. Add a new one.

---

## 5. Backups and restore

Everything that matters is in the database: wallets, the ledger, invoices, messages and audit
logs. Plus uploaded sender-ID documents, which live in S3 or `LOCAL_DATA_DIR/storage`.

**Recommended**
- Use a managed MySQL/MariaDB with point-in-time recovery, *or* binary-log archiving plus
  Mariabackup/XtraBackup on self-hosted databases.
- Also take a nightly logical dump for portability (`--single-transaction` takes a consistent
  InnoDB snapshot without locking tables):

```bash
docker compose exec -T db sh -c 'mariadb-dump -u root -p"$MARIADB_ROOT_PASSWORD" --single-transaction --routines --triggers smsflow' \
  | gzip > backups/smsflow-$(date +%F).sql.gz
```

- Store backups off-host and encrypted, e.g. an S3 bucket with object lock or versioning. Keep 7 daily, 4 weekly and 12 monthly copies,
  or whatever your finance and legal retention rules require (invoices usually need years).
- Back up the storage bucket or volume with the same schedule.
- **Back up the secrets separately.** Without `SETTINGS_ENCRYPTION_KEY`, encrypted provider
  secrets in the backup cannot be read. Without `API_KEY_PEPPER`, API keys stop working.

**Restore drill (do it quarterly)**

```bash
docker compose exec -T db sh -c 'mariadb -u root -p"$MARIADB_ROOT_PASSWORD" -e "CREATE DATABASE smsflow_restore CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"'
gunzip -c backups/smsflow-YYYY-MM-DD.sql.gz | docker compose exec -T db sh -c 'mariadb -u root -p"$MARIADB_ROOT_PASSWORD" smsflow_restore'
# Point a staging app at smsflow_restore; verify sign-in, wallet balances, invoices, reports.
```

A quick integrity check after restoring: for every wallet, `balance` should equal the last
ledger entry's `balance_after`.

```sql
-- Table names are snake_case; column names are camelCase.
SELECT w.organizationId, w.balance,
  (SELECT t.balanceAfter FROM wallet_transactions t
   WHERE t.organizationId = w.organizationId ORDER BY t.createdAt DESC, t.id DESC LIMIT 1) AS lastBalanceAfter
FROM wallets w
HAVING lastBalanceAfter IS NOT NULL AND w.balance <> lastBalanceAfter;   -- expect zero rows
```

---

## 6. Monitoring and alerting

**Health endpoint.** `GET /api/health` returns 200 when the database is reachable and 503 otherwise. It also reports
`stuckQueuedMessages` (queued messages that have been due for more than 5 minutes). It exposes no secrets.
The Docker image's `HEALTHCHECK` uses it.

**Logs.** The app emits structured JSON through pino to stdout, so ship stdout to your log platform.
Passwords, tokens, API secrets and authorization headers are redacted, and phone numbers are masked.
Every API response carries `X-Request-Id`, which appears in `api_logs` and in error logs.

**Suggested alerts**

| Signal | Source | Suggested threshold |
|---|---|---|
| App down | `/api/health` not 200 | 2 consecutive failures |
| Worker stalled | `stuckQueuedMessages` > 0 | For 10 minutes |
| Worker not running | No `worker` log lines | For 5 minutes |
| Delivery failure spike | `messages` with status FAILED/REJECTED in the last hour ÷ total | > 20% (tune per provider) |
| Provider errors | Log lines `provider send failed, will retry` | Sudden increase |
| Unhandled errors | Log level `error` with `unhandled API error` or `onRequestError` | Any |
| Payments waiting | `payments` in AWAITING_VERIFICATION older than 24h | Any (business alert) |
| Database | Connections, disk, replication lag, long transactions | Provider defaults |
| TLS certificate | Expiry | < 14 days |

Useful SQL for dashboards:

```sql
-- Throughput and outcomes, last 24h
SELECT status, count(*) FROM messages WHERE "createdAt" > now() - interval '24 hours' GROUP BY status;
-- Queue depth
SELECT count(*) FROM messages WHERE status = 'QUEUED';
-- Top API error codes, last hour
SELECT "errorCode", count(*) FROM api_logs
WHERE "createdAt" > now() - interval '1 hour' AND "statusCode" >= 400 GROUP BY 1 ORDER BY 2 DESC;
```

**Data retention.** Housekeeping deletes expired sessions, idempotency keys, rate-limit
buckets and old verification tokens. It expires stale online payments after 48 hours. `api_logs`, `message_events` and `webhook_deliveries` grow
indefinitely. Schedule a cleanup, or partition by month, following your retention policy (e.g. 90 days for API
logs). Messages and ledger entries back invoices and disputes, so keep them longer.

---

## 7. Security checklist before launch

- [ ] HTTPS only, behind a proxy; the app sends HSTS and a strict CSP.
- [ ] Unique production secrets, stored in a secret manager, never in the image or git.
- [ ] `ALLOW_MOCK_PAYMENTS` unset or false; `mock` not in `PAYMENT_PROVIDERS`.
- [ ] `SMS_PROVIDER_WEBHOOK_SECRET` set: unsigned delivery reports are rejected.
- [ ] The database is not reachable from the internet; it uses a least-privilege DB user.
- [ ] The bootstrap admin password has been changed; admin accounts are limited to the people who need them.
- [ ] Backups run, and a restore has been tested.
- [ ] Legal pages reviewed; placeholder contact details replaced.
- [ ] Sender-ID, content and quiet-hour policies in Admin → Settings match current BTRC rules
      and your provider's requirements. The platform enforces what you configure; it does not
      certify regulatory compliance.

---

## 8. Scaling notes

- **Web:** add instances behind the load balancer. Use `STORAGE_PROVIDER=s3`.
- **Worker:** add instances; `WORKER_INTERVAL_MS` and batch sizes trade latency against DB load.
- **Database:** the hot paths are `messages` inserts, status updates and the queue claim, all
  of which are indexed. Beyond a few million messages a month, consider monthly partitioning of
  `messages`/`message_events`/`api_logs`, and a read replica for reports.
- **Rate limiting** uses database upserts. It is fine for moderate API traffic. At very high request
  rates, move `src/lib/rate-limit.ts` to Redis; the interface is a single function.
