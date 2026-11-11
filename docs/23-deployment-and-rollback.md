# 23 — Dynamic SMS & manual payments: deployment and rollback

Nothing here has been run against production. Every production step below needs the owner's
explicit go-ahead. Read `19-production-stability-checklist.md` first: **a push to `main`
auto-deploys the Next.js panel**.

## 1. What ships, and what is switched on by what

| Change | Active when | Flag |
|---|---|---|
| Migration `2026_11_11_000001` (additive) | `php artisan migrate --force` | — |
| Batch processing, pause/resume/cancel actors, progress endpoint | Laravel code deployed | always (core) |
| No routine admin approval (risk-only holds) | Laravel code deployed | always (core) |
| Ambiguous provider outcomes → `UNKNOWN`, no auto-refund | Laravel code deployed | always (core) |
| Provider response persisted (code, redacted summary, timestamps) | Laravel code deployed | always (core) |
| Dynamic SMS API / page / sidebar item | both flags on | `FEATURE_DYNAMIC_SMS=true` (Laravel) + `dynamicSms` in `LARAVEL_FEATURES` (Next.js) |
| Payment methods, top-up requests, admin review | both flags on | `FEATURE_MANUAL_TOPUPS=true` + `manualTopups` |
| Sender catalog | both flags on | `FEATURE_SENDER_CATALOG=true` + `senderCatalog` |
| Admin "Unconfirmed SMS" and "Campaign processing" pages | `admin` in `LARAVEL_FEATURES` | existing |

`LARAVEL_FEATURES=all` does **not** enable the three opt-in modules; they must be named:
`LARAVEL_FEATURES=all,dynamicSms,manualTopups,senderCatalog`. With a module off, its pages 404, its
nav items are hidden and its API answers `403 FEATURE_DISABLED`.

## 2. Database changes (review before running)

Verified on MariaDB 10.4.32 (local XAMPP): `migrate` → `migrate:rollback --step=1` → `migrate`
→ `migrate` (no-op). `php artisan app:schema-check` against the pre-migration reference reports
exactly these 27 differences and nothing else:

- new tables `payment_methods`, `campaign_uploads`, `provider_sender_ids`
- `campaigns`: `kind`, `batchSize`, `currentBatch`, `unknownCount`, `dynamicConfig`, `pausedById`,
  `resumedAt`, `cancelledById`, `cancelReason`, `lastBatchAt`
- `messages`: `batchNumber`, `providerStatusCode`, `providerResponse`, `providerRequestedAt`,
  `providerRespondedAt`; `status` enum + `UNKNOWN`; indexes `(campaignId,batchNumber)`,
  `(organizationId,senderValue,createdAt)`, `(status,updatedAt)`
- `message_events.status` enum + `UNKNOWN`
- `payments`: `paymentMethodId`; `status` enum + `UNDER_REVIEW`; indexes `(paymentMethodId)`,
  `(provider,manualReference)`

All new columns are nullable or defaulted, enum values are appended last, no data is rewritten.
The **old** Laravel code runs unchanged on the **new** schema. `database/schema/expected-schema.json`
now describes the post-migration schema; the previous one is kept as
`expected-schema.pre-20261111.json`.

Index creation on `messages` copies nothing on MariaDB 10.4+/MySQL 8 (online DDL), but takes time
proportional to the table: run it in a quiet hour.

## 3. Pre-flight (local / staging) — results of this change

- Backend: `php artisan test` → **309 passed** (265 existing + 44 new), MariaDB 10.4, mock provider,
  no real payment gateway. The pre-change baseline on the same database was 265/265.
- Five existing tests were updated because the behaviour they pinned was changed on purpose
  (unconfirmed → `UNKNOWN` not refunded; campaign messages go through batches; launch message text;
  table count 42 → 45).
- Frontend: `tsc --noEmit` clean, `eslint` clean, `vitest --project unit` 148/148, `next build` OK.
- Browser (Laravel mode, local): Dynamic SMS upload → mapping → preview (incl. Bangla) →
  confirmation → queued without approval → charged once → batch progress; admin payment methods,
  manual payments, sender catalog, unconfirmed SMS and processing pages; customer Pay manually.
- `pint --test` clean on changed PHP files.

## 4. Production deployment (when approved)

1. **Backup** the production database (hPanel → Databases → Backups, or `mysqldump`). Note the
   current Laravel build and Next.js commit.
2. **Laravel: migrate first.** Upload only the migration file and the new
   `database/schema/expected-schema*.json`, then from the API folder:
   `php artisan app:schema-check` (expect "matches" against the *old* file) →
   `php artisan migrate --force` → confirm the 27 differences above and nothing else.
   The live (old) code keeps working on the new schema.
3. **Laravel code:** upload the zip of `backend/` (Extract with Overwrite merges, keeps `.env`
   and `storage/`). Do **not** set the three `FEATURE_*` variables yet. Then
   `php artisan config:clear && php artisan route:clear` and `php artisan app:schema-check` (expect
   "matches"). From now on campaigns are batched, routine campaigns are no longer held, and
   ambiguous provider outcomes are held as UNKNOWN.
4. `storage/app/private` must exist, be writable, and survive future zip deploys (CSV uploads,
   payment proofs and QR images live there; they are never web-served).
5. **Scheduler cron** must run (`php artisan schedule:run` every minute): batches are sent by the
   worker tick. Small campaigns (≤ 200 messages) still start inline; larger ones depend on the cron.
6. **Next.js:** merging to `main` deploys it. Safe before or after step 3: without the new API
   fields the batch selector and progress card stay hidden. Customer-visible wording changes ship
   immediately: "Sent" → "Accepted", "In review" → "Safety check", cancel dialog with reason.
7. **Enable modules one at a time**, each with both switches, then restart/rebuild:
   - Laravel `.env`: `FEATURE_MANUAL_TOPUPS=true` → configure payment methods as SUPER_ADMIN with
     verified accounts → Next.js `LARAVEL_FEATURES=all,manualTopups`.
   - Then `FEATURE_DYNAMIC_SMS=true` + `dynamicSms`; then `FEATURE_SENDER_CATALOG=true` + `senderCatalog`.
8. Settings: review **Admin → Campaign processing** (defaults: sizes 10/100, default 100,
   concurrency 5 for Automas, risk rules as in docs/21). The old
   `sms.policy.reviewThresholdRecipients` value is ignored.

Never enable a real payment gateway or change payment receiving details as part of a deploy; those
are owner actions in the admin UI.

## 5. Rollback

| Situation | Action |
|---|---|
| A module misbehaves | Turn its `FEATURE_*` off (config:clear) and remove it from `LARAVEL_FEATURES`. Data stays. |
| Laravel code problem | Re-deploy the previous `backend/` zip. It works on the migrated schema, **except** that old code cannot read `UNKNOWN` messages or `UNDER_REVIEW` payments (its enums lack them; listing them errors). Resolve them first (Admin → Unconfirmed SMS, Manual payments). |
| Remove the schema | Only after the code rollback: `php artisan migrate:rollback --step=1 --force`. It refuses while any `UNKNOWN` message, `UNDER_REVIEW` payment or `DYNAMIC` campaign exists (it would corrupt them). Verify with `app:schema-check` against `expected-schema.pre-20261111.json`. |
| Next.js problem | Revert the merge commit on `main` (auto-redeploys). |

The Prisma path of the panel does not know `UNKNOWN`/`UNDER_REVIEW`: once the migration is live,
do not move `campaigns`, `reports`, `payments` or `wallet` back off Laravel in `LARAVEL_FEATURES`.

## 6. Open items that need the owner

1. **Automas sender IDs cannot be fetched automatically.** Its documented API has no listing
   endpoint (sender IDs live in its web panel); the catalog sync works for providers that expose
   one (mock today). Until Automas offers it, add approved IDs by hand in Admin → Sender catalog.
2. **Automas delivery reports.** Its panel shows a "DLR Push" setting with an unknown payload
   format; without it, messages stop at *Accepted*. Wiring it needs a sample payload and its
   signing method (webhook endpoint and verification already exist).
3. **Real receiving accounts** for bKash/Nagad/Rocket/bank must be entered by the owner.
4. **`FRONTEND_PROXY_SECRET`** appears missing on the panel (all users share one IP for per-IP
   limits) — unrelated to this change but affects the new upload/payment rate limits too.
