# SMSFlow API (Laravel 12)

The backend of SMSFlow BD: a REST API under `/api/v1` on the **same MySQL/MariaDB database** as the
Next.js app, which it replaces module by module.

- Audit of the existing backend and decisions: [../docs/10-laravel-api-audit.md](../docs/10-laravel-api-audit.md)
- Architecture, all routes, migration matrix, deployment: [../docs/11-laravel-api-reference.md](../docs/11-laravel-api-reference.md)
- Customer SMS API (OpenAPI 3.1): [docs/openapi-public.yaml](docs/openapi-public.yaml)
- Migration plan: [../docs/09-laravel-migration-plan.md](../docs/09-laravel-migration-plan.md)

Laravel 12 on PHP 8.2+ (security support ends February 2027: plan the upgrade to 13), MySQL 8+ /
MariaDB 10.4+.

## API at a glance

| Audience | Auth | Paths |
|---|---|---|
| Customers' servers | `Authorization: Bearer sfk_live_…` (API key, scopes) | `/sms/send`, `/sms/bulk`, `/sms/estimate`, `/messages`, `/messages/{id}`, `/balance`, `/sender-ids` |
| Dashboard (via the Next.js server) | `Authorization: Bearer <session token>` from `/auth/login` | `/auth/*`, `/profile/*`, `/app/*` |
| Platform staff | session + platform role | `/admin/*` |
| Public | none (rate-limited) | `/health`, `/public/*`, `/auth/login`, `/auth/register`, … |
| Providers | signature / gateway re-validation | `/webhooks/*`, `/payments/{provider}/return` |

Envelope: `{ "success": true, "data": …, "meta": { "requestId": "req_…" } }` /
`{ "success": false, "error": { "code", "message", "details"? }, "meta": { … } }`.

## Local setup

```bash
cd backend
composer install
cp .env.example .env          # set APP_ENV=local, APP_DEBUG=true, DB_*, FRONTEND_URL and the shared secrets
php artisan key:generate
php artisan migrate           # adopts an existing SMSFlow database, or creates the schema
php artisan serve             # http://localhost:8000/api/v1/health
php artisan schedule:work     # background work locally (or: php artisan sms:work)
```

The shared secrets (`AUTH_SECRET`, `API_KEY_PEPPER`, `SETTINGS_ENCRYPTION_KEY`) must equal the
Next.js app's values: existing API keys, OTPs and encrypted provider settings depend on them.

## Code map

```
app/Http/Controllers/Api/V1/<Domain>/   thin controllers
app/Http/Requests/                      Form Requests (validation)
app/Http/Resources/                     API Resources (explicit fields; no secret can leak)
app/Http/Middleware/                    request id, session auth, tenant/permission, staff role,
                                        API key + api_logs, idempotency, DB rate limits, verified email
app/Services/<Domain>/                  business logic (ported 1:1 from src/features + src/services)
app/Jobs/                               LaunchCampaign, DispatchMessages, ProcessContactImport
routes/api.php                          all routes;  routes/console.php  scheduler + commands
config/smsflow.php                      policies, limits, features, secrets (from env)
```

## Database: adopting the existing schema

`database/migrations/0001_01_01_000000_smsflow_baseline_schema.php` holds the 42 application
tables (copied from the Prisma migration `20260930000000_init_mysql`, in `database/sql/`):

- all tables present (existing database) → nothing is changed, the migration is only recorded;
- empty database → the schema is created;
- some tables missing → it stops with an error and changes nothing.

It cannot be rolled back. Laravel adds only its own tables (`migrations`, `cache`, `cache_locks`,
`jobs`, `job_batches`, `failed_jobs`). Laravel's default `users`/`sessions`/`password_reset_tokens`
migration is deliberately absent: those names belong to the application, and `SESSION_DRIVER`
must never be `database`. No schema change was needed for the API.

Never run `migrate:fresh`, `migrate:reset`, `migrate:rollback` or `db:wipe` against a real database.

## Background work

One cron entry: `* * * * * cd /path/to/backend && php artisan schedule:run >> /dev/null 2>&1`
(runs `sms:work` every minute, drains the database queue, housekeeping every 10 minutes).

## Tests

Tests need a local MySQL/MariaDB database named `smsflow_api_test` (it is wiped):

```sql
CREATE DATABASE smsflow_api_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

```bash
php artisan test        # 175 tests
vendor/bin/pint --test
```

`tests/TestCase.php` refuses to run against any database that is not local and named `*test*`.
`tests/Fixtures/node-compat.json` was produced by running the Node implementation; the PHP ports
must match it byte for byte.
