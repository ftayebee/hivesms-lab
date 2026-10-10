# 19 · Production stability and backend redeploy — operator checklist

Date: 2026-10-10. Code: commit `73ad90f` (`origin/main`). **Every step below is read-only unless marked GATE.**
GATE steps change production and need explicit approval first. Never paste secret values into chat, tickets or this file.

> Do not push this file (or anything) to `main` while the incident is open: Hostinger rebuilds and redeploys the
> production frontend on every push (that is how `73ad90f` is already live on `sms.hivelabsbd.com`).

## 0. Current state (verified 2026-10-10, unauthenticated read-only probes)

| Probe | Result | Meaning |
|---|---|---|
| `GET https://sms.hivelabsbd.com/api/health` (3×) | `503 {"status":"degraded","database":"unreachable"}` | the Next.js app cannot query its database |
| `GET https://sms.hivelabsbd.com/api/v1/admin/exports/customers` | 404 "Exports need the Laravel admin API" | frontend build **is `73ad90f`** (that message only exists there) |
| `/api/health` has no `api` / `laravelFeatures` field | — | `LARAVEL_FEATURES` is **unset**: every feature runs on Prisma (rollback path intact) |
| `GET https://smsbackend.hivelabsbd.com/api/v1/health` | `200 {"status":"ok","database":"ok"}` | Laravel reaches the same database |
| `GET …/api/v1/app/sms/composer`, `/admin/dashboard`, `/admin/finance/summary` | 404 | backend still the **old** build (`73ad90f` backend not deployed) |
| `GET …/api/v1/admin/settings/billing-policy` | 405 | same |

Impact while the frontend database is down: sign-in, dashboard and admin pages, the customer API on
`sms.hivelabsbd.com/api/v1/*`, webhooks on that domain and the Node worker cron (SMS sending, delivery polling) all use
Prisma and fail. Marketing pages still render.

Why the error is hidden: `src/app/api/health/route.ts` catches **every** error (missing variable, wrong password,
missing grant, pool timeout, missing table/column) as `"database":"unreachable"` and does not log it. Find the cause
with § A.

## A. Frontend database failure — diagnosis (read-only)

| # | Step (where) | Expected / what to record |
|---|---|---|
| A1 | `curl -s -w ' [%{http_code}]\n' https://sms.hivelabsbd.com/api/health` (repeat 3×) | today: 503 every time; after a fix: `200 … "database":"ok"` |
| A2 | hPanel → Websites → `sms.hivelabsbd.com` → Node.js app → **Deployments** | latest deployment = commit `73ad90f`, status success. Record the **build command** (`npm run build` or `npm run build:deploy`) and the **Node.js version** |
| A3 | Same app → **Settings**: Node.js version | must be **24.x** (`package.json` `"engines": {"node": "24.x"}`; doc 07's "22" is outdated). Record only |
| A4 | Same app → **Runtime logs** (stdout/stderr). Search for: `Invalid environment configuration`, `DATABASE_URL is not set`, `PrismaClient`, `P1001`, `P1000`, `P2024`, `ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND`, `ER_ACCESS_DENIED`, `ER_DBACCESS_DENIED`, `Too many connections`, `request error` | note the **first** error after the latest deploy (code only). `/api/health` itself logs nothing; sign-in attempts and dashboard requests do (`request error`, `server action failed`) |
| A5 | Same app → **Environment variables**. Do **not** reveal values | `DATABASE_URL` present; starts with `mysql://`; host part (not secret) noted; database and user names equal Laravel's `DB_DATABASE` / `DB_USERNAME`; password contains no raw `@ : / ? #` (must be URL-encoded) |
| A6 | Laravel `.env` (SSH, backend dir): `grep -E '^DB_(HOST|PORT|DATABASE|USERNAME)=' .env` (no password) | Laravel's host is usually `localhost`. PHP uses the **Unix socket** for `localhost`; Node's driver uses **TCP**, where `localhost` resolves to IPv6 `::1` first on Node 17+ (verified on Node 24). A server listening only on `127.0.0.1`/socket refuses `::1` → Laravel OK, Next.js down |
| A7 | hPanel → Databases → **Management** | database and user exist; user assigned to the database with **ALL PRIVILEGES**; hostname shown (same-account apps: `localhost`). Remote MySQL is **not** needed for apps on the same account |
| A8 | **Connection test over SSH** (read-only, below) from the frontend app directory | see interpretation table |
| A9 | Cron log of the Node worker (`~/cron/smsflow-tick.log` per doc 07 § 13) — read only | errors since the outage = queued SMS not processed; record the time of the first failure |
| A10 | (needs `CRON_SECRET`, § C4) `/internal/ready` → `stuckQueuedMessages` | `0` = no messages stuck; > 0 = messages waiting since the outage (Laravel's scheduler is not processing them unless its cron exists — § D7) |

### A8 — connection test (prints no secrets, writes nothing)

Hostinger injects hPanel environment variables into the app process, not into the SSH shell, so paste the value at a
hidden prompt. Run from the frontend app directory (where `node_modules/mariadb` exists; for the standalone build also
`.next/standalone`). Save the script as `db-diagnose.cjs` in your home directory, run, then delete it.

```bash
read -rs DATABASE_URL && export DATABASE_URL && node ~/db-diagnose.cjs; unset DATABASE_URL
```

```js
// db-diagnose.cjs — read-only: SELECT/SHOW only; prints error codes, never the URL, user or password.
const mariadb = require("mariadb");
const raw = process.env.DATABASE_URL || "";
if (!raw) { console.log("DATABASE_URL: NOT SET in this shell"); process.exit(2); }
let u;
try { u = new URL(raw); } catch { console.log("DATABASE_URL: not a valid URL (check quoting / URL-encoding of the password)"); process.exit(2); }
const pw = decodeURIComponent(u.password);
const base = { port: Number(u.port || 3306), user: decodeURIComponent(u.username), password: pw, database: decodeURIComponent(u.pathname.replace(/^\//, "")), connectTimeout: 5000 };
console.log(JSON.stringify({
  scheme: u.protocol, host: u.hostname, port: base.port, userSet: !!base.user, passwordLength: pw.length,
  passwordHasRawSpecials: /[@:/?#]/.test(u.password), databaseSet: !!base.database, sslParam: u.searchParams.get("ssl"),
}));
const err = (e) => ({ code: e.code, errno: e.errno, sqlState: e.sqlState });
(async () => {
  for (const host of [...new Set([u.hostname, "127.0.0.1"])]) {
    let c;
    try {
      c = await mariadb.createConnection({ ...base, host });
      const [v] = await c.query("SELECT VERSION() AS version, @@max_connections AS maxConnections, @@max_user_connections AS maxUserConnections, @@wait_timeout AS waitTimeout");
      const [t] = await c.query("SHOW GLOBAL STATUS LIKE 'Threads_connected'");
      const [tables] = await c.query("SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()");
      const [col] = await c.query("SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'messages' AND COLUMN_NAME = 'nextAttemptAt'");
      const [mig] = await c.query("SELECT COUNT(*) AS applied, SUM(finished_at IS NULL) AS unfinished FROM _prisma_migrations").catch(() => [{ applied: "table missing" }]);
      const grants = (await c.query("SHOW GRANTS")).map((r) => Object.values(r)[0]);
      const privs = [...new Set(grants.flatMap((g) => (g.match(/^GRANT (.+?) ON/) || [, ""])[1].split(",").map((s) => s.trim())))].filter(Boolean);
      await c.query("SELECT 1 FROM messages LIMIT 1");
      console.log(host, "-> CONNECTED", JSON.stringify({
        version: v.version, maxConnections: Number(v.maxConnections), maxUserConnections: Number(v.maxUserConnections), waitTimeout: Number(v.waitTimeout),
        threadsConnectedNow: Number(t?.Value), tablesInDatabase: Number(tables.n), messagesNextAttemptAt: Number(col.n) === 1,
        prismaMigrations: { applied: Number(mig.applied) || mig.applied, unfinished: Number(mig.unfinished || 0) }, privileges: privs, messagesReadable: true,
      }));
    } catch (e) {
      console.log(host, "-> FAILED", JSON.stringify(err(e)));
    } finally {
      if (c) await c.end().catch(() => {});
    }
  }
})();
```

Tested locally (MariaDB 10.4, Node 24): success, wrong password, refused port and unset variable each give the expected line.

| Output | Cause | Proposed fix (**GATE**, needs approval) |
|---|---|---|
| `localhost -> FAILED ECONNREFUSED`, `127.0.0.1 -> CONNECTED` | IPv6 `localhost` (A6) | change only the host in `DATABASE_URL` to `127.0.0.1`, redeploy the app (no code change) |
| both `ER_ACCESS_DENIED_ERROR` (1045) | wrong user/password, or password not URL-encoded (`passwordHasRawSpecials: true`) | correct `DATABASE_URL` (URL-encode the password) |
| `ER_BAD_DB_ERROR` (1049) | wrong database name | correct the name |
| `ER_DBACCESS_DENIED_ERROR` (1044) | user not assigned to the database | assign in hPanel → Databases |
| `ER_TOO_MANY_USER_CONNECTIONS` (1203) / `ER_CON_COUNT_ERROR` (1040) | connection limit | compare `maxUserConnections` with the budget below; lower `DATABASE_POOL_SIZE` or Laravel workers |
| `ETIMEDOUT` / `ENOTFOUND` | remote hostname (e.g. `srv….hstgr.io`) used from inside hosting, or Remote MySQL not enabled | use the local hostname from A7 |
| `CONNECTED` but `messagesNextAttemptAt: false`, few tables, or `unfinished > 0` | schema / failed migration | **stop**: no migration; send the output |
| `CONNECTED`, everything as expected | the server can reach the database; the **running app** gets a different value | compare A5 with what you pasted; check A4 for `Invalid environment configuration` |
| `DATABASE_URL: not a valid URL` | quoting / encoding | fix the value |

Connection budget (both apps use the **same** database user): Next.js pool `DATABASE_POOL_SIZE` (default 10) per
running Node process + Node worker cron + Laravel PHP requests + Laravel scheduler/queue. The sum must stay below
`maxUserConnections` (0 = no per-user limit, then `maxConnections`). The one Laravel `503` on 2026-10-08
(`req_JiM3tzND0sbRtOzs`) fits a limit being hit.

## B. Backend redeploy from `73ad90f` — preparation (done locally) and steps

Bundle (built with `git archive` from the commit; git-ignored; not uploaded):

| Item | Value |
|---|---|
| File | `backend/dist/smsflow-backend-73ad90f.zip` |
| SHA-256 | `1d6da6d30f0a44bd15c2688582abb7df0972d86ccb6429518dc515bc2e40cf7c` |
| Content | 406 entries = every tracked `backend/` file of `73ad90f` except `tests/`, `phpunit.xml`, `dist/`, `backend.zip` |
| Excluded (verified) | `.env`, `vendor/`, keys/certs; `.env.example` has only empty secret values |
| Required changes included | all 32 added/modified backend source files since `8033e1e` (Super Admin: `AdminFinanceController`, `AdminStaffController`, `AdminExportController`, `FinanceService`, `StaffService`, `PrivilegedActionGuard`, `PlatformDashboardService`, `ReadinessService`, 4 requests, `Permissions.php`, routes, `console.php`; frontend API additions: composer endpoint, payment methods policy, manual instructions, public pricing fields, admin overview/billing-policy/api-logs/messages/audit-logs/resources) |
| Old bundles | `backend.zip` and `dist/smsflow-backend-2026-10-07.zip` are **stale** — do not use |
| Schema / migrations | **none** in this release (`database/` unchanged since `8033e1e`) |

| # | Step | Expected |
|---|---|---|
| B1 | Locally: `sha256sum backend/dist/smsflow-backend-73ad90f.zip` | the SHA-256 above |
| B2 | Backups first: hPanel database backup (or `mysqldump`) and a copy of the backend folder (rename to `*_old_YYYYMMDD`, do not delete) | backup files exist |
| B3 | On the server, **current** backend: `bash deploy/hostinger.sh preflight` | ends with `Preflight passed. Nothing was changed.` (§ C1, C2) — if it fails, stop |
| B4 | **GATE (deploy)**: upload the zip, unzip into `~/domains/smsbackend.hivelabsbd.com/backend`, keeping the existing `.env` and `storage/` (doc 13 § 1) | files replaced; `.env` untouched |
| B5 | **GATE**: `bash deploy/hostinger.sh install` | `composer install --no-dev` OK; `Install done. No database changes were made.` |
| B6 | `php artisan migrate:status` — **do not run `migrate`** | every migration `Ran`; nothing `Pending` (if anything is pending: stop) |
| B7 | `bash deploy/hostinger.sh preflight` again | passes; schema unchanged |
| B8 | `bash deploy/hostinger.sh verify` | health ok; exposure probes 403/404; foreign CORS origin `none`; `api/v1` route count **202** (187 before) |
| B9 | § C5 probes | 401 instead of 404/405 |
| B10 | Laravel log: `tail -n 100 storage/logs/laravel-$(date +%F).log` (or `laravel.log`) | no new `ERROR` lines |

Rollback of the backend: restore the `*_old_YYYYMMDD` folder (and `optimize:clear`); no data or schema changed.
The frontend is unaffected either way (all flags off; it does not call Laravel).

## C. Verification commands and expected results

### C1 `php artisan app:deploy-check` (backend dir; read-only)

Prints a table; exit code 0 = no FAIL. Secrets appear only as `len N, fp xxxxxxxxxxxx`.

| Row | Expected |
|---|---|
| PHP >= 8.2, ext-pdo_mysql/openssl/mbstring/bcmath/ctype/fileinfo/tokenizer/curl, argon2id | OK |
| proc_open | OK (WARN acceptable: then remove `->runInBackground()` before enabling the scheduler) |
| APP_ENV=production, APP_DEBUG=false, APP_KEY set, APP_URL https, FRONTEND_URL https | OK (`FRONTEND_URL` = `https://sms.hivelabsbd.com`) |
| AUTH_SECRET, API_KEY_PEPPER, SETTINGS_ENCRYPTION_KEY, FRONTEND_PROXY_SECRET (≥32), CRON_SECRET (≥16) | OK; record each `fp` for § D1 |
| SESSION_DRIVER != database | OK |
| SMS_PROVIDER not mock | OK, or WARN if the provider is set only in Admin settings |
| mock payments off | OK |
| database connection / 42 application tables / Laravel tables / existing data readable | OK, `42 found`, `present` (do not paste the user/organization counts) |
| writable storage + bootstrap/cache, log write | OK |

### C2 `php artisan app:schema-check` (read-only)

Expected exactly:

```
| expected | 42 | 471 | 130 | 49 | 3a80edb55e6ffe3e |
| database | 42 | 471 | 130 | 49 | 3a80edb55e6ffe3e |
Application schema matches the expected baseline exactly.
```

Any difference → **stop**, do not migrate, send the diff lines.

### C3 Health

```bash
curl -s https://smsbackend.hivelabsbd.com/api/v1/health
```
Expected: `{"success":true,"data":{"status":"ok","database":"ok"},…}` — repeat 5×; any `503` → § A connection budget.

Frontend (after § A is fixed): `curl -s https://sms.hivelabsbd.com/api/health` → `200`, `"database":"ok"`, **no** `api` field.

### C4 `/api/v1/internal/ready` (bearer = Laravel `CRON_SECRET`)

From the backend dir on the server; the secret never appears in output or the process list:

```bash
HDR="$(umask 077; mktemp)"; printf 'Authorization: Bearer %s\n' "$(grep -E '^CRON_SECRET=' .env | head -1 | cut -d= -f2- | tr -d '"')" > "$HDR"; curl -s -H "@$HDR" https://smsbackend.hivelabsbd.com/api/v1/internal/ready; echo; rm -f "$HDR"
```

| Check | Expected now |
|---|---|
| database, cache, secrets, appKey, debugOff, mockPaymentsOff, sessionDriver | `ok` |
| smsProvider | `ok` or `ok (adapter not verified against the provider)`; `fail` if the provider is `mock` in production |
| smsWebhookSecret | `ok` (secret configured) |
| mailer | `ok` (`MAIL_MAILER` not `log`/`array`) |
| scheduler | `fail` until a Laravel `schedule:run` cron exists — **expected** at this stage (overall 503) |
| queueBacklog / failedJobs / stuckQueuedMessages | informational: `ok` / a number / a number (record) |

Without the header the endpoint answers `401` (verified).

### C5 New endpoints (unauthenticated GET; deployed = 401, old build = 404/405)

```bash
B=https://smsbackend.hivelabsbd.com/api/v1; for p in app/sms/composer admin/settings/billing-policy admin/dashboard admin/finance/summary admin/finance/transactions admin/finance/margins admin/finance/provider-costs admin/system/health admin/exports/customers admin/staff/permissions admin/staff/history; do printf '%-34s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' "$B/$p")"; done
```
Expected: **401** on every line. And:

```bash
curl -s https://smsbackend.hivelabsbd.com/api/v1/public/pricing | grep -o '"maximumTopUp"\|"balanceValidityMonths"'
```
Expected: both keys printed. Write endpoints (wallet adjustments, refunds, staff, provider costs) are verified only
after the owner exists (§ E), on a staff test organization.

## D. Production values to verify (record OK / not OK — never the value)

| # | Value | How (read-only) | Expected |
|---|---|---|---|
| D1 | Shared secrets `AUTH_SECRET`, `API_KEY_PEPPER`, `SETTINGS_ENCRYPTION_KEY`, `FRONTEND_PROXY_SECRET`, `CRON_SECRET` | Laravel: `fp` from C1. Next.js (value from hPanel, hidden prompt): `read -rs S; S="$S" node -e "const v=process.env.S;console.log('len',v.length,'fp',require('crypto').createHash('sha256').update('smsflow-fp:'+v).digest('hex').slice(0,12))"; unset S` | same `len` and `fp` in both apps for each secret; Next.js `FRONTEND_PROXY_SECRET` is probably **unset** today (needed only before enabling flags) |
| D2 | Database identity | A5 / A6 / A8 | both apps: same database and user; Next.js host reachable over TCP |
| D3 | `APP_URL` (Next.js) / `FRONTEND_URL` (Laravel) | hPanel / `grep -c '^FRONTEND_URL=https://sms.hivelabsbd.com' .env` | both `https://sms.hivelabsbd.com` |
| D4 | Mailer (Laravel) | `grep -E '^MAIL_MAILER=' .env` (not a secret) and `grep -cE '^MAIL_(HOST|PORT|USERNAME|FROM_ADDRESS)=.+' .env` | `MAIL_MAILER` = `smtp` (or another real transport), 4 lines present; C4 `mailer: ok`. Required before Super Admin invitations/resets |
| D5 | Trusted proxies (Laravel) | `grep -cE '^TRUSTED_PROXIES=.+' .env` | `1` if Laravel sits behind Cloudflare/LiteSpeed (it does: `Server: cloudflare`). Value must cover the proxy hops so `X-Forwarded-For` is honoured; record presence only |
| D6 | Document storage | Next.js hPanel: `STORAGE_PROVIDER`, `LOCAL_DATA_DIR`; Laravel: `grep -E '^DOCUMENTS_DISK=' .env` | `local` (copy with `scripts/copy-sender-id-documents.mjs` before `senderIds`) — if `s3`: Laravel S3 adapter is **not installed** (blocker for `senderIds`) |
| D7 | Scheduler / cron state | hPanel → Advanced → Cron Jobs (list only) | record which exist: Node tick (`/api/internal/worker/tick`) = current SMS processor; Laravel `schedule:run` = should **not** exist yet (C4 `scheduler: fail` confirms). Both together are safe but not intended |
| D8 | Payment / SMS mode | Laravel: `grep -E '^(PAYMENT_PROVIDERS|ALLOW_MOCK_PAYMENTS|SMS_PROVIDER)=' .env`; Next.js: same names in hPanel | `PAYMENT_PROVIDERS=manual`, `ALLOW_MOCK_PAYMENTS` false/unset, `SMS_PROVIDER` the real provider (or set in Admin settings); identical in both apps |
| D9 | `LARAVEL_FEATURES` (Next.js) | hPanel | unset (confirmed by `/api/health`) — keep it so |
| D10 | `BOOTSTRAP_ADMIN_EMAIL` (Next.js) | hPanel | unset (prevents the legacy Node bootstrap path) |
| D11 | Node.js version (frontend app) | hPanel app settings | 24.x |
| D12 | Build command (frontend app) | hPanel | record: `npm run build:deploy` runs `prisma migrate deploy` on every push |

## E. Super Admin bootstrap — separate gate, later

Preconditions (all): § A fixed and `sms.hivelabsbd.com/api/health` → 200; § B deployed; C1 no FAIL; C2 exact match;
C4 all required checks `ok`; C5 all 401; D4 mailer verified. Then, and only with approval:
1. Read-only: confirm no active super admin exists (Admin → Users filtered by role, or
   `SELECT COUNT(*) FROM users WHERE platformRole='SUPER_ADMIN' AND status='ACTIVE'`).
2. **GATE**: `php artisan platform:bootstrap-owner <owner e-mail> --name="<name>"` on the backend host (doc 18 § 2).
   It refuses if an owner exists, asks for the e-mail again, and prints a 60-minute set-password link once.
3. Review existing ADMIN/SUPPORT accounts (ADMIN no longer adjusts wallets in this release).

## F. What not to do

No `migrate`, `migrate:fresh/reset/rollback`, `db:wipe`, `key:generate` on an existing key; no `LARAVEL_FEATURES`
change; no permission, pricing, wallet, payment, provider or settings change; no production account creation; no
real SMS or payment tests; no pushes to `main` until the frontend database is healthy and a push is intended.
