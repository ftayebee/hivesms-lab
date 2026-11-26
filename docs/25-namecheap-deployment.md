# 25 · Deploying on Namecheap shared hosting (Stellar plans)

This guide runs MZ SMS on a Namecheap **Stellar / Stellar Plus / Stellar Business** shared hosting
account (cPanel on CloudLinux). It needs no VPS and no Docker. For a VPS use `docker-compose.yml`
([20-docker](20-docker.md)) or [04-deployment](04-deployment.md).

| Part | Runs as | Address (example) |
|---|---|---|
| Laravel API (`backend/`) | PHP site in cPanel | `https://api.example.com` |
| Next.js panel + website | cPanel **Setup Node.js App** (Passenger) | `https://example.com` |
| Database | cPanel **MySQL® Databases** | `localhost` |
| Background sending | cPanel **Cron Jobs**, every minute | Laravel scheduler |

The browser only ever talks to the Next.js site; Next.js calls the Laravel API server-side
([16 §3.4](16-production-cutover-runbook.md)).

> **Have a VPS as well?** Running the app on the VPS with Docker and pointing just one subdomain
> of your Namecheap-hosted domain at it is simpler and more robust than this guide. Your main
> website stays on Namecheap. See [20-docker › Subdomain of a domain whose website is hosted
> elsewhere](20-docker.md#subdomain-of-a-domain-whose-website-is-hosted-elsewhere).

> **Check before you buy or deploy.** Namecheap's limits differ per plan and change over time.
> Values below marked *check* were not verifiable from Namecheap's public pages; confirm them in
> your own cPanel or with Namecheap support:
>
> - **Setup Node.js App** is present and offers **Node.js 24** (`package.json` requires 24.x).
>   Namecheap's knowledge base lists 24.x, but versions are per server.
> - **SSH access / Terminal** in cPanel (*check*; this guide has a no-SSH path).
> - **Remote MySQL** in cPanel (needed only for the no-SSH path).
> - **Select PHP Version** offers PHP **8.2+** (8.3 recommended).
> - Resource limits (cPanel sidebar → *Resource usage*). Published figures: Stellar ≈ 1 GB RAM,
>   50 % CPU, 20 entry processes; Stellar Plus/Business ≈ 2 GB RAM and more processes.
>   **Stellar Plus or Business is recommended**: the Node app and every PHP request share these limits.

---

## 0. Plan the domains

Use one domain for the panel and a subdomain for the API, both on this hosting account:

- `example.com` → the Node.js app (panel, website, customer REST API proxy, webhooks).
- `api.example.com` → the Laravel API.

In cPanel → **Domains**, create the subdomain `api.example.com` with document root
`/home/USER/api.example.com/backend/public` (set the document root when you create it; this is
what keeps `.env`, `vendor/` and logs out of the web root). `USER` is your cPanel user name.

Turn on **SSL** for both: cPanel → **SSL/TLS Status** → *Run AutoSSL* (Namecheap's free
certificate) or install the PositiveSSL certificate. The app requires HTTPS in production
(HSTS, `Secure` / `__Host-` cookies): sign-in does not work over plain HTTP.

## 1. Database

cPanel → **MySQL® Databases**:

1. Create a database, e.g. `USER_mzsms` (cPanel prefixes names with your user name).
2. Create a user, e.g. `USER_mzsms`, with a long random password. Avoid `@ : / ? #`, or
   URL-encode them in `DATABASE_URL` later.
3. **Add user to database** → *ALL PRIVILEGES* (migrations need CREATE/ALTER/INDEX).

Host is `localhost` for both apps. Migrations create every table as `utf8mb4_unicode_ci`, so
Bangla text is stored correctly whatever the server default is.

## 2. Secrets (generate once, keep in a password manager)

On your computer:

```bash
node -e "for (const k of ['AUTH_SECRET','API_KEY_PEPPER','SETTINGS_ENCRYPTION_KEY','FRONTEND_PROXY_SECRET','CRON_SECRET']) console.log(k + '=' + require('crypto').randomBytes(32).toString('base64url'))"
```

The five values **must be identical in both apps** ([16 §3.1](16-production-cutover-runbook.md)).
Losing `API_KEY_PEPPER` breaks every customer API key; losing `SETTINGS_ENCRYPTION_KEY` makes the
stored provider/payment credentials unreadable.

## 3. Laravel API

### 3.1 PHP version and extensions

cPanel → **Select PHP Version** (for the `api` subdomain, or account-wide): choose **8.3** and
enable at least `pdo_mysql`, `mbstring`, `openssl`, `bcmath`, `intl`, `fileinfo`, `curl`, `zip`,
`sodium`. In *Options* set `memory_limit = 512M`, `max_execution_time = 300`,
`upload_max_filesize = 16M`, `post_max_size = 16M` (CSV imports and the 50,000-row report import
need the time and size).

### 3.2 Upload the code

On your computer, in `backend/`:

```bash
composer install --no-dev --optimize-autoloader
```

Zip the `backend/` folder **without** `.env`, `tests/`, `storage/logs/*` and `node_modules`, upload
it with cPanel **File Manager** to `/home/USER/api.example.com/` and extract it, so that
`/home/USER/api.example.com/backend/public/index.php` exists. (With SSH you can instead
`git clone` and run `composer install --no-dev` on the server; Namecheap has Composer on most
servers, *check* with `composer -V`.)

Permissions: `storage/` and `bootstrap/cache/` must be writable by your user (File Manager →
*Permissions* `755` for folders is enough on CloudLinux; never `777`).

### 3.3 `backend/.env`

Create it from `backend/.env.example` in File Manager. Values to set:

| Key | Value |
|---|---|
| `APP_NAME` | `"MZ SMS"` |
| `APP_ENV` / `APP_DEBUG` | `production` / `false` |
| `APP_URL` | `https://api.example.com` |
| `APP_KEY` | generate once (`php artisan key:generate --force`, or locally and paste) |
| `FRONTEND_URL` | `https://example.com` |
| `AUTH_SECRET`, `API_KEY_PEPPER`, `SETTINGS_ENCRYPTION_KEY`, `FRONTEND_PROXY_SECRET`, `CRON_SECRET` | from step 2 |
| `DB_HOST` / `DB_PORT` | `localhost` / `3306` |
| `DB_DATABASE` / `DB_USERNAME` / `DB_PASSWORD` | from step 1 |
| `SESSION_DRIVER` / `CACHE_STORE` / `QUEUE_CONNECTION` | `array` / `database` / `database` |
| `QUEUE_WORKER_VIA_SCHEDULER` | `true` (no Supervisor on shared hosting) |
| `TRUSTED_PROXIES` | `*` (Namecheap's front proxy; needed for correct client IPs) |
| `SMS_PROVIDER` + `SMS_PROVIDER_API_KEY` + `SMS_DEFAULT_SENDER_ID` | your gateway ([05-integrations](05-integrations.md)); `mock` sends nothing |
| `PAYMENT_PROVIDERS` | `manual` (add `sslcommerz` only after sandbox testing); never `mock` |
| `MAIL_MAILER` / `MAIL_HOST` / `MAIL_PORT` / `MAIL_SCHEME` | `smtp` / `mail.example.com` / `465` / `smtps` (a mailbox created in cPanel → **Email Accounts**) |
| `MAIL_USERNAME` / `MAIL_PASSWORD` / `MAIL_FROM_ADDRESS` | that mailbox, e.g. `no-reply@example.com` |
| `DOCUMENTS_DISK` | `local` (files stay in `backend/storage/app/private`, outside the web root) |
| `FEATURE_DYNAMIC_SMS`, `FEATURE_MANUAL_TOPUPS`, `FEATURE_SENDER_CATALOG`, `FEATURE_REPORT_IMPORT` | `true` for each module you want ([23](23-deployment-and-rollback.md), [24](24-report-import.md)) |
| `LOG_LEVEL` | `warning` |

Then make the file private: File Manager → `.env` → *Permissions* `600`.

### 3.4 Migrate, cache and create the owner

**With SSH / cPanel Terminal** (in `/home/USER/api.example.com/backend`; if `php` is not the
version you selected, use the full path cPanel shows, e.g. `/opt/alt/php83/usr/bin/php`):

```bash
php artisan app:deploy-check           # every row OK or WARN; fix FAIL rows first
php artisan migrate --force            # empty database → creates the full schema
php artisan platform:bootstrap-catalog # permissions, example pricing plans, credit packages
php artisan platform:bootstrap-owner you@example.com --name="Your Name"
php artisan config:cache && php artisan route:cache && php artisan event:cache
```

`bootstrap-owner` prints a **single-use link to set your password** (valid 60 minutes). Open it
after the Next.js app is live (step 4), or run the command again later to get a new link.

**Without SSH:** enable cPanel → **Remote MySQL** for your home IP, then run the same `migrate`,
`bootstrap-catalog` and `bootstrap-owner` commands **on your computer** from `backend/`, with
`DB_HOST` set to your server's hostname (shown in cPanel's *General Information*) and the same
five secrets as production. Remove your IP from Remote MySQL afterwards. Skip the `*:cache`
commands (they write files on the machine that runs them); the app works without them.

Check: `https://api.example.com/api/v1/health` returns JSON with `"status":"ok"`.

### 3.5 Cron (background sending)

cPanel → **Cron Jobs** → *Add New Cron Job*, **Once Per Minute** (`* * * * *`):

```
cd /home/USER/api.example.com/backend && /opt/alt/php83/usr/bin/php artisan schedule:run >> /dev/null 2>&1
```

(Use the PHP path for the version you selected; plain `php` in cron is often a different
version.) Every minute this launches scheduled campaigns, sends queued SMS (`sms:work`), drains
the queue, polls delivery and runs housekeeping. Set the cron e-mail field empty, or you get a
mail every minute.

## 4. Next.js panel

### 4.1 Build on Linux, then upload

The build contains native modules (`@node-rs/argon2`) compiled for the machine that builds it,
and `next build` needs more memory than a Stellar account allows. So **build on Linux x64**, not
on the server and not on plain Windows. On Windows use WSL (Ubuntu) with Node 24:

```bash
cd /path/to/project            # inside WSL
npm ci
APP_URL=https://example.com npm run build
npm run package:cpanel         # → dist/panel-standalone.tar.gz
```

`APP_URL` must be the final address at build time (it is baked into sitemap, canonical URLs and
pre-rendered pages). `package:cpanel` copies `.next/static` and `public/` into the standalone
server and packs it, without any `.env` file.

### 4.2 Create the Node.js app

cPanel → **Setup Node.js App** → *Create Application*:

| Field | Value |
|---|---|
| Node.js version | **24.x** |
| Application mode | Production |
| Application root | `mzsms-panel` (folder in your home directory, outside `public_html`) |
| Application URL | `example.com` |
| Application startup file | `server.js` |

Create it, then **Stop App**. Upload `dist/panel-standalone.tar.gz` into `/home/USER/mzsms-panel/`
with File Manager and *Extract* it there, so `/home/USER/mzsms-panel/server.js` exists. Do **not**
press *Run NPM Install*: the archive already contains its `node_modules`.

### 4.3 Environment variables

In the app's page → *Environment variables* → *Add Variable*, one per row:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `APP_URL` | `https://example.com` |
| `LARAVEL_API_URL` | `https://api.example.com/api/v1` |
| `LARAVEL_FEATURES` | `all,dynamicSms,manualTopups,senderCatalog,reportImport` (only the modules switched on in step 3.3) |
| `LARAVEL_API_TIMEOUT_MS` | `60000` |
| `DATABASE_URL` | `mysql://USER_mzsms:PASSWORD@localhost:3306/USER_mzsms` (validated at startup) |
| `DATABASE_POOL_SIZE` | `3` |
| `AUTH_SECRET`, `API_KEY_PEPPER`, `SETTINGS_ENCRYPTION_KEY`, `FRONTEND_PROXY_SECRET`, `CRON_SECRET` | from step 2, identical to Laravel |
| `WORKER_IN_PROCESS` | `false` (Laravel's cron does the sending) |
| `PAYMENT_PROVIDERS` | same as Laravel |
| `LOCAL_DATA_DIR` | `/home/USER/mzsms-data` (absolute, outside the app folder) |
| `LOG_LEVEL` | `info` |

Then **Start App** (or *Restart* after any change). `https://example.com/api/health` should
report `"status":"ok"` and list your `laravelFeatures`.

### 4.4 First sign-in

Open the password link printed by `bootstrap-owner`, set a password, sign in at
`https://example.com/login` and open `/admin`. Then in **Admin → Settings** set the website
content, SMS policy and provider, and in **Admin → Pricing** your real prices.

## 5. Updating

1. Locally: `npm run typecheck`, `npm run lint`, `npm test`; backend `php vendor/bin/phpunit`.
2. **Laravel first**: upload the changed `backend/` files (keep the server's `.env` and
   `storage/`), run `composer install --no-dev` if `composer.lock` changed, then
   `php artisan migrate --force` and the three `*:cache` commands. New migrations are additive,
   so the old panel keeps working against the new API.
3. **Then the panel**: build and `npm run package:cpanel` in WSL, *Stop App*, delete the old
   `.next/` and `node_modules/` in `mzsms-panel/`, extract the new archive, *Start App*.
4. Check `/api/health` on both, sign in, and watch the next cron minute (Admin → System health).

## 6. Backups

- cPanel → **Backup** (or JetBackup if your plan has it): download a database backup before
  every update and on a schedule; the database holds wallets, the ledger and invoices.
- Keep off-site copies of the five secrets, `backend/.env` and `backend/storage/app/private`
  (sender ID documents, payment proofs).
- Restore into a **new empty** database first to test; never over the live one while the apps run.

## 7. Limits on shared hosting

| Topic | Effect | When it matters |
|---|---|---|
| ~1 GB RAM (Stellar), shared by Node and PHP | the panel may be restarted by CloudLinux under load ("Resource limit reached", 503/508) | busy periods; use Stellar Plus/Business |
| Entry processes (≈20 on Stellar) | extra concurrent requests get **508** | many dashboard users or API clients at once |
| CPU cap | large CSV imports, Dynamic SMS uploads and big report imports are slow | files near 10 MB / 50,000 rows: split them |
| Cron every minute | campaigns start and retries run up to 1 minute late; one tick sends up to roughly 2,000 SMS | campaigns of tens of thousands take several minutes |
| No Supervisor / Redis / Docker | not needed by this app | — |

Move to a VPS (Namecheap VPS or any other; run `docker-compose.yml`) when you send large
campaigns regularly, see 508/503 errors in cPanel's *Resource Usage*, or need faster sending
than once a minute.

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Node app shows "Incomplete response" / 503 at once | wrong startup file, Node < 24, or a variable fails validation | startup file `server.js`; Node 24; read `/home/USER/mzsms-panel/stderr.log` (Passenger log) |
| `Error: Cannot find module '@node-rs/argon2-linux-x64-…'` | the panel was built on Windows/macOS | rebuild in WSL/Linux (step 4.1) |
| Sign-in loops back to the login page | site opened over `http://`, or `APP_URL` ≠ real address | force HTTPS; fix `APP_URL` and rebuild |
| Pages say "service temporarily unavailable" | Next.js cannot reach Laravel | `LARAVEL_API_URL`, the API's SSL, and `https://api.example.com/api/v1/health` |
| Everyone shares one IP in login limits / audit logs | `FRONTEND_PROXY_SECRET` differs between apps or `TRUSTED_PROXIES` unset | make them identical; set `TRUSTED_PROXIES=*` |
| SMS stay "Queued" | cron not running or wrong PHP path | run the cron command in Terminal; check Admin → System health |
| Customer API keys rejected | `API_KEY_PEPPER` differs between the apps | make it identical (never change it after launch) |
| `SQLSTATE[HY000] [1045] Access denied` | user not added to the database, or wrong password | cPanel → MySQL® Databases → *Add user to database* |
| 500 on the API with nothing useful | `APP_DEBUG=false` hides details | read `backend/storage/logs/laravel.log` |

Sources for Namecheap specifics: [How to work with Node.js App](https://www.namecheap.com/support/knowledgebase/article.aspx/10047/2182/how-to-work-with-nodejs-app/),
[Resource limits (LVE)](https://www.namecheap.com/support/knowledgebase/article.aspx/1127).
