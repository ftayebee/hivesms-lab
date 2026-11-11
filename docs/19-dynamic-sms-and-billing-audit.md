# 19 — Dynamic SMS, campaign processing and manual billing: audit

Audit date: 2026-11-11. Scope: the Laravel API (`backend/`, authoritative) and the Next.js panel
(`src/`, BFF). Nothing was changed in any database during the audit. (Not to be confused with
`19-production-stability-checklist.md`, which is an older document with the same number.)

## 1. What already exists (reused, not rewritten)

| Area | Existing implementation | Reuse |
|---|---|---|
| Campaigns | `campaigns`, `campaign_recipients` tables; `CampaignService` (draft/estimate/submit/pause/resume/cancel/retry/duplicate), `CampaignRunner` (audience resolution, launch, finalize), `LaunchCampaignJob` | Extended with a `DYNAMIC` kind, batch size, batch counters, actor/reason columns |
| Personalisation | `{{var}}` placeholders, `MessageSegmentCalculator::renderTemplate()`; recipient variables already stored per row in `campaign_recipients.variables` | Dynamic SMS renders with a strict renderer (unknown/missing values are errors, not empty strings) |
| Charging | One wallet debit per campaign at launch (`wallet_transactions` unique `(reason, referenceType, referenceId)`), per-message refunds keyed `(REFUND, message, id)` | Unchanged: the charge happens exactly once, so pause/resume can never charge twice |
| Dispatch | `DispatcherService`: lease claiming with `SELECT … FOR UPDATE` by primary key (no `SKIP LOCKED`, MariaDB 10.4 safe), in-flight marker (`provider` set before the HTTP call), retry only for "certainly not sent" failures | Extended to claim per campaign in batches of the campaign's batch size and to respect a per-provider concurrency limit |
| Pause / resume / cancel | Status transitions exist; the claim query only takes messages of `PROCESSING` campaigns, so in-flight requests finish and nothing new is claimed | Added actor, reason, notifications and the cancel/refund guard for ambiguous outcomes |
| Status history | `message_events` with a unique `dedupeKey`; `DeliveryService::apply()` is forward-only and idempotent | Reused for provider responses, webhooks, polls and admin resolution |
| Provider abstraction | `SmsProviderInterface` (mock, http, automas) with `SendSmsResult::accepted / failed(retryable) / unconfirmed` | Added `listSenderIds()` and raw-response capture |
| Webhooks | `/webhooks/sms/{provider}` with `verifyWebhook()` signature check, idempotent by `dedupeKey` | Unchanged; Automas documents no webhooks, so its messages stay "Accepted" |
| Reports | `ReportService` reads only local tables | Added sender/campaign filters and provider reference columns; provider API is never called for reports |
| Manual payments | `payments` with `provider = manual`, `AWAITING_VERIFICATION`; admin approve → `PaymentService::complete()` (row lock + conditional update + unique ledger key + unique invoice) | Reused as the manual top-up request: no second payment table |
| Private files | `DocumentStorage` (size, sniffed MIME, extension, magic bytes, random org-scoped key on a private disk) | Reused for payment proofs, QR images and dynamic CSV uploads |
| Settings + audit | `settings` table via `SettingsService`; `AuditLogger` with before/after | New `campaign.processing` setting; every payment-method change audited with before/after |
| Notifications | `NotificationService` (in-app + email, preferences); `notifications.organizationId` is nullable | Added campaign lifecycle and payment types; staff notifications use `organizationId = NULL` |
| Feature flags | `LARAVEL_FEATURES` (`src/lib/laravel/flags.ts`) | Added **opt-in** flags that `all` does not enable |

## 2. Gaps found

1. No CSV-to-message column mapping; the Send SMS page only extracts phone numbers from a CSV.
2. Unknown placeholders silently render as empty text (`renderTemplate`), which is unsafe for dynamic data.
3. No batch concept: the worker claims up to 100 due messages across all campaigns; no batch counters.
4. Routine admin approval: every campaign over `reviewThresholdRecipients` (default **5,000**) waits in `PENDING_REVIEW`, regardless of risk.
5. Ambiguous provider outcomes (`unconfirmed`, interrupted sends) are closed as `FAILED` **and refunded** automatically. The requirement is: never refund an ambiguous outcome; hold it for review.
6. The provider response is not stored (only `providerMessageId`, `errorCode`); no request/response timestamps.
7. No configurable receiving accounts (bKash/Nagad/Rocket/bank); manual instructions are one free-text setting.
8. Manual top-ups take a reference only: no amount-per-method limits, sender number, payment time, proof upload or `under_review` stage.
9. Sender IDs are only customer-requested; there is no platform catalog or bulk assignment.

## 3. Backend changes

- `CampaignUploadService` (CSV upload, header detection, preview, statistics), `DynamicCampaignService` (mapping validation, strict rendering, estimate, submit).
- `CampaignRunner::launch()` materialises dynamic rows (per-row sender, per-row rate, per-row segments) inside the same single-charge transaction.
- `DispatcherService::processCampaignBatches()` — per-campaign batches, provider concurrency, `currentBatch`/`batchNumber`.
- `UNKNOWN` message status: ambiguous outcomes stay charged and are listed for staff review (`admin/messages/unconfirmed`, resolve as delivered/failed-with-refund).
- Provider response persisted immediately (`providerStatusCode`, redacted `providerResponse`, `providerRequestedAt`, `providerRespondedAt`) plus a `message_events` row with the same payload.
- Review only for genuine risk (risk heuristics, per-account `requireCampaignReview` control); the recipient-count threshold no longer holds campaigns.
- `PaymentMethodService` (Super Admin CRUD + reorder + QR upload, audited before/after), `ManualTopUpService` (customer submit/cancel, staff review/under-review/approve/reject/notes, proof download).
- `SenderCatalogService` (provider sync when the provider supports listing, manual entries, multi-organization assignment into existing `sender_ids`).

## 4. Frontend changes

- Sidebar item **Dynamic SMS** under Send SMS; page `/dashboard/dynamic-sms` (upload → mapping → editor with field chips → row preview → confirmation).
- Campaign detail: batch progress (current batch, processed, accepted, delivered, failed, unconfirmed, pending), pause/resume/cancel with reason.
- Wallet: "Pay manually" section listing active methods with copy buttons and QR, top-up request form with proof upload, request history.
- Admin: **Payment methods** (settings), **Manual payments** review queue, **Sender catalog**, **Unconfirmed messages**, campaign-processing settings.

## 5. Database changes (one additive migration, documented before creation)

`2026_11_11_000001_dynamic_sms_and_manual_payments` — additive only, MariaDB 10.4 compatible, safe to re-run (every step checks first):

| Table | Change |
|---|---|
| `campaigns` | `kind ENUM('STANDARD','DYNAMIC')`, `batchSize`, `currentBatch`, `unknownCount`, `dynamicConfig JSON`, `pausedById`, `resumedAt`, `cancelledById`, `cancelReason`, `lastBatchAt` |
| `messages` | status enum + `UNKNOWN`; `batchNumber`, `providerStatusCode`, `providerResponse JSON`, `providerRequestedAt`, `providerRespondedAt`; indexes `(campaignId, batchNumber)`, `(organizationId, senderValue, createdAt)`, `(status, updatedAt)` |
| `message_events` | status enum + `UNKNOWN` |
| `payments` | status enum + `UNDER_REVIEW`; `paymentMethodId`; index `(provider, manualReference)` |
| `payment_methods` | new (receiving accounts) |
| `campaign_uploads` | new (private dynamic CSV metadata, tenant-scoped, expiring) |
| `provider_sender_ids` | new (provider sender catalog) |

No campaign, message, wallet or transaction table is duplicated. Enum values are appended at the end (metadata-only change).

## 6. API endpoints (all under `/api/v1`)

Customer (session + tenant permission):
`POST app/dynamic-sms/uploads`, `GET app/dynamic-sms/uploads/{id}`, `GET app/dynamic-sms/template`, `POST app/dynamic-sms/preview`, `POST app/dynamic-sms/estimate`, `POST app/dynamic-sms/submit` (idempotent),
`GET app/campaigns/{id}/progress`, `POST app/campaigns/{id}/cancel` (now accepts `reason`),
`GET app/payment-methods`, `GET app/payment-methods/{id}/qr`, `GET|POST app/topup-requests`, `GET app/topup-requests/{id}`, `GET app/topup-requests/{id}/proof`, `POST app/topup-requests/{id}/cancel`.

Staff:
`GET|POST admin/payment-methods`, `PUT|DELETE admin/payment-methods/{id}`, `POST admin/payment-methods/{id}/qr`, `POST admin/payment-methods/reorder`,
`GET admin/topup-requests`, `GET admin/topup-requests/{id}`, `GET admin/topup-requests/{id}/proof`, `POST admin/topup-requests/{id}/{under-review|approve|reject|notes}`,
`GET admin/sender-catalog`, `POST admin/sender-catalog`, `POST admin/sender-catalog/sync`, `PUT admin/sender-catalog/{id}/assignments`,
`GET admin/messages/unconfirmed`, `POST admin/messages/{id}/resolve`,
`GET|PUT admin/settings/campaign-processing`.

## 7. Security considerations

- Tenant isolation: every customer query is filtered by `organizationId` from the session (never from input); upload, campaign, request and proof ids of another tenant answer 404.
- CSV: size/row limits, UTF-8 validation (BOM stripped), no formulas evaluated; values are plain text in SMS; exports keep the existing formula-injection guard (`Csv::sanitizeCell`).
- Sender IDs in CSV must match an `APPROVED` sender of the organization, row by row.
- Files: sniffed MIME + magic bytes + extension allow-list, random keys, private disk, downloads only through authenticated endpoints, `..` refused.
- Money: credits only through `PaymentService::complete()` (locked, conditional, unique ledger key); rejection never credits; customers cannot reach staff endpoints; approval requires `admin:topups:approve` (SUPER_ADMIN) and password re-confirmation.
- Payment-method changes: SUPER_ADMIN only (`admin:settings:manage`), audited with before/after.
- Provider responses are redacted (keys/tokens/secrets/passwords removed) and capped at 2 KB.
- Ambiguous provider outcomes are never retried or refunded automatically.

## 8. Testing plan

PHPUnit feature tests on the isolated `smsflow_api_test` MariaDB database with the mock SMS provider and no real payment gateway: dynamic upload/mapping/rendering/Bangla/segments/duplicates/cross-tenant; batch sizes 10 and 100, pause/resume/cancel, concurrent workers, interrupted sends, unknown outcomes, single charge; approval removal with suspension/sender/opt-out/risk controls kept; provider response persistence, accepted vs delivered, duplicate/invalid webhooks; payment methods, top-up submit/approve/reject/double approve/cross-tenant/proof privacy; sender catalog assignment. Frontend: `typecheck`, `lint`, `vitest`, `next build`.
