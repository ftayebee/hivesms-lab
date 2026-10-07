# 13 — Staging deployment of the Laravel API to smsbackend.hivelabsbd.com

Goal: Laravel **live for smoke tests** at `https://smsbackend.hivelabsbd.com` while the production
website stays **Next.js → Prisma**. Nothing here switches traffic, sends SMS, takes payments or
touches the 42 application tables.

Everything that changes the server is a separate, explicit phase of
[`backend/deploy/hostinger.sh`](../backend/deploy/hostinger.sh). Every check is read-only and prints
secrets only as fingerprints.

## 0. What was observed from outside (2026-10-07)

| Probe | Result | Meaning |
|---|---|---|
| `GET /api/v1/health` | 503 `"Database unavailable."` | **Old build**: current code says "Service unavailable." The DB connection fails on the server |
| `GET /api/v1/internal/ready` | 404 | Old build (route did not exist) |
| `/.env`, `/.env.example`, `/.htaccess` | 403 | Blocked |
| `/artisan`, `/composer.*`, `/vendor/autoload.php`, `/backend.zip` | 404 | Not exposed |
| `/storage/`, `/vendor/`, `/database/`, `/resources/` | 301 → 404 | Routed into Laravel, not served |
| `/storage/logs/laravel.log` | 403 | Not readable, but the request shape shows the files sit under the web root |
| HTTP → HTTPS | 301 via Cloudflare | OK |
| Inferred document root | the **backend folder**, with `backend/.htaccess` rewriting into `public/` | Safe fallback, but not the requested `backend/public` |
| Direct MySQL from outside (`srv1495.hstgr.io:3306`) | connection timeout | Remote MySQL not allowed for outside IPs (expected on Hostinger) |

## 1. Upload the current code

Bundle: `backend/dist/smsflow-backend-2026-10-07.zip` (296 files).

It does **not** contain `.env`, `vendor/`, `tests/`, logs, uploads or `phpunit.xml`. It does contain
`composer.lock`, `deploy/hostinger.sh` and `database/schema/expected-schema.json`.

Recommended server layout (SSH, Hostinger usernames look like `u211574503`):

```
~/domains/smsbackend.hivelabsbd.com/
├── backend/                ← unzip here (keep the existing backend/.env and backend/storage/)
└── public_html  → backend/public   (symlink = document root)
```

1. hPanel → Files → back up the current subdomain folder (download it or rename it to `*_old`; do not delete).
2. Upload the zip and unzip it so the files land in `~/domains/smsbackend.hivelabsbd.com/backend`.
   If an older `backend/` exists, keep its `.env` and `storage/` and replace everything else.
3. **Document root = `backend/public`.** Hostinger fixes a subdomain's folder when the subdomain is
   created, so use a symlink:
   ```
   cd ~/domains/smsbackend.hivelabsbd.com
   mv public_html public_html_old_$(date +%Y%m%d)
   ln -s backend/public public_html
   ```
   Hostinger's exact folder names are UNVERIFIED — check them with `ls ~/domains/` first. If the
   subdomain lives elsewhere (e.g. `~/public_html/smsbackend`), apply the same symlink there. The
   `backend/.htaccess` rewrite keeps the old layout safe in the meantime.

## 2. `.env` on the server

Start from `backend/.env.example`. Values that must be set:

| Key | Value |
|---|---|
| `APP_ENV` / `APP_DEBUG` | `production` / `false` |
| `APP_URL` | `https://smsbackend.hivelabsbd.com` |
| `FRONTEND_URL` | `https://sms.hivelabsbd.com` |
| `APP_KEY` | keep the existing value. If empty, `php artisan key:generate --force` is safe **once**: no application data is encrypted with it (verified: secrets use `SETTINGS_ENCRYPTION_KEY`; no `Crypt::`, encrypted casts, signed URLs or cookies) |
| `AUTH_SECRET`, `API_KEY_PEPPER`, `SETTINGS_ENCRYPTION_KEY` | **copy exactly** from the production Next.js app (hPanel → Node.js app → Environment variables) |
| `CRON_SECRET` | any ≥16 chars |
| `FRONTEND_PROXY_SECRET` | new, ≥32 random chars; later also set on the Next.js app |
| `DB_CONNECTION` | `mysql` |
| `DB_HOST` | `localhost` from Hostinger web hosting (UNVERIFIED — use the host hPanel → Databases shows for *this* hosting account; `srv1495.hstgr.io` is the *remote* host and needs Remote MySQL access) |
| `DB_PORT` / `DB_DATABASE` / `DB_USERNAME` / `DB_PASSWORD` | the database the Next.js app uses |
| `SESSION_DRIVER` / `CACHE_STORE` / `QUEUE_CONNECTION` | `array` / `database` / `database` |
| `SMS_PROVIDER` | leave `mock`: production **refuses** to send with it (intended; readiness stays RED) |
| `PAYMENT_PROVIDERS` | `manual` (no SSLCommerz until sandbox-tested) |
| `ALLOW_MOCK_PAYMENTS` | unset |
| `MAIL_MAILER` | `smtp` + Hostinger mailbox, or leave `log` (readiness flags it) |
| `LOG_LEVEL` | `warning` |

`LARAVEL_API_URL` belongs to the **Next.js** app (not this `.env`), and only at cutover. The
client accepts `https://smsbackend.hivelabsbd.com` or `…/api/v1`.

**Secret compatibility without revealing values:** `app:deploy-check` prints a fingerprint for each
secret (`sha256("smsflow-fp:" + value)`, first 12 hex characters). Compute the same for the Next.js
values on the Node side (SSH into the Node app, or locally with the values from hPanel):

```
node -e "for (const k of ['AUTH_SECRET','API_KEY_PEPPER','SETTINGS_ENCRYPTION_KEY']) console.log(k, require('crypto').createHash('sha256').update('smsflow-fp:'+(process.env[k]||'')).digest('hex').slice(0,12))"
```

Each fingerprint must be identical on both sides.

## 3. Run the phases (SSH, in `backend/`)

```
bash deploy/hostinger.sh install            # composer --no-dev, caches. No DB writes
bash deploy/hostinger.sh preflight          # read-only: deploy-check, migrate:status, db:show, schema check
bash deploy/hostinger.sh migrate --confirm  # ONLY after preflight passes; see §4
bash deploy/hostinger.sh verify             # health, readiness, exposure, HTTPS, CORS, routes
bash deploy/hostinger.sh cron               # prints the cron line; do NOT add it yet
```

If `preflight` shows `database connection FAIL`, the row contains the driver error with the user and
host masked:

| SQLSTATE / message | Cause | Fix |
|---|---|---|
| `[1045] Access denied for user '<user>'@'<host>'` | wrong user/password, or the user is not assigned to this DB | hPanel → Databases → reset the password / assign the user. Don't guess |
| `[2002] Connection refused / timed out` | wrong `DB_HOST` (e.g. the remote host without Remote MySQL) | use the local host shown in hPanel |
| `[1049] Unknown database` | wrong `DB_DATABASE` (Hostinger prefixes `u<id>_`) | copy the exact name |
| `[2054] / caching_sha2` | auth plugin mismatch | ask Hostinger, or use a native-password user |

## 4. Database safety

- The baseline migration is a guarded **no-op** when all 42 tables exist, **refuses** to run on a
  partial schema, and cannot be rolled back.
- `migrate` therefore only adds Laravel's own tables: `migrations`, `cache`, `cache_locks`, `jobs`,
  `job_batches`, `failed_jobs`. Readiness needs `cache` (rate limits, locks) and `jobs`.
- `php artisan migrate --pretend` is **misleading** for the baseline: in pretend mode `hasTable`
  returns nothing, so it prints all 42 `CREATE TABLE`s although the real run changes nothing. The
  script proves safety instead with `app:schema-check`. It compares 42 tables, 471 columns,
  130 indexes and 49 foreign keys with `database/schema/expected-schema.json` before and after, and
  stops if anything differs.
- Never run `migrate:fresh`, `db:wipe`, `migrate:reset`, `migrate:rollback`.
- Take a `mysqldump` first (docs/12 §26).

## 5. Authentication smoke test (test account only)

Use a dedicated test user, never a customer. The password is read from the terminal, so it isn't
kept in shell history:

```
read -rp 'Test email: ' E; read -rsp 'Password: ' P; echo
TOKEN=$(curl -s https://smsbackend.hivelabsbd.com/api/v1/auth/login -H 'Content-Type: application/json' \
  --data "$(php -r 'echo json_encode(["identifier"=>$argv[1],"password"=>$argv[2]]);' "$E" "$P")" | php -r '$j=json_decode(stream_get_contents(STDIN),true); echo $j["data"]["token"] ?? "";')
unset P
[ -n "$TOKEN" ] && echo "login OK" || echo "login FAILED"
HDR=$(umask 077; mktemp); printf 'Authorization: Bearer %s\n' "$TOKEN" > "$HDR"
curl -s -H @"$HDR" https://smsbackend.hivelabsbd.com/api/v1/auth/me | head -c 300; echo
curl -s -X POST -H @"$HDR" https://smsbackend.hivelabsbd.com/api/v1/auth/logout; echo
curl -s -o /dev/null -w 'after logout: %{http_code}\n' -H @"$HDR" https://smsbackend.hivelabsbd.com/api/v1/auth/me
rm -f "$HDR"; unset TOKEN
```

Expected: login OK → `/me` shows the user → logout → `/me` 401.

Existing-session compatibility: log in on `https://sms.hivelabsbd.com` (Next.js), copy the
`__Host-sf_session` cookie value from the browser's dev tools, and use it as the Bearer token for
`/auth/me`. It must return the same user and organization.

## 6. Cron / worker — keep OFF

`bash deploy/hostinger.sh cron` prints the exact line, with the server's real PHP binary path. Add it
in hPanel → Advanced → Cron Jobs **only after** the SMS provider is verified **and** the Node worker
is switched off (docs/12 §12, §17). Until then readiness reports `scheduler: fail` — expected.

## 7. Expected result of this stage

| Check | Expected now |
|---|---|
| Health | 200 `{"success":true,"data":{"status":"ok","database":"ok"}}` |
| Readiness | **503 (RED, intended)**: `smsProvider` fail (mock refused), `smsWebhookSecret` fail, `scheduler` fail; `mailer` fail if `log`; everything else ok |
| Schema | identical to baseline before and after |
| Exposure | all 403/404 |
| CORS | `https://sms.hivelabsbd.com` allowed, foreign origin gets no `Access-Control-Allow-Origin`, never `*` |
| Routes | 187 under `api/v1` |
| Logs | `storage/logs/laravel-*.log`, not web-reachable; phone numbers masked; no passwords, keys, `Authorization` headers or DB credentials are logged by the app |
