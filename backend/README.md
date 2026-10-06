# SMSFlow API (Laravel 12)

The backend for the SMSFlow Next.js app, being migrated from Next.js + Prisma step by step. Plan
and status: [../docs/09-laravel-migration-plan.md](../docs/09-laravel-migration-plan.md).

- Laravel 12, PHP 8.2+ (Laravel 12 security support ends February 2027: plan the upgrade to 13).
- MySQL 8+ / MariaDB 10.4+ — the **same database** as the Next.js app.
- REST API under `/api/v1`, JSON envelope identical to the existing public API:
  `{ "success": true, "data": …, "meta": { "requestId": "req_…" } }` /
  `{ "success": false, "error": { "code", "message", "details"? }, "meta": { … } }`.

## Local setup

```bash
cd backend
composer install
cp .env.example .env          # set DB_* to your local MySQL, FRONTEND_URL, shared secrets
php artisan key:generate
php artisan migrate           # adopts an existing SMSFlow database, or creates the schema
php artisan serve             # http://localhost:8000/api/v1/health
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
must never be `database`.

Never run `migrate:fresh`, `migrate:reset` or `migrate:rollback` against a real database.

## Tests

Tests need a local MySQL/MariaDB database named `smsflow_api_test` (it is wiped):

```sql
CREATE DATABASE smsflow_api_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

```bash
php artisan test
```

`tests/TestCase.php` refuses to run against any database that is not local and named `*test*`.
