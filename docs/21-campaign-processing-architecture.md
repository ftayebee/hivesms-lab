# 21 — Campaign processing architecture

How campaigns are validated, charged, sent in batches, paused, resumed, cancelled and recorded.
Laravel (`backend/`) does all of it; Next.js only calls the API.

## 1. Lifecycle

```
customer submits ─► validate (content, recipients, schedule, quiet hours)
                 ─► account active? sender ID approved? opt-outs/suppression/blocklist applied
                 ─► estimate + wallet balance check ─► risk check
                 ─► SCHEDULED  (or PENDING_REVIEW only when a risk control matched)
LaunchCampaignJob / worker ─► launch(): claim SCHEDULED→PROCESSING atomically,
                 re-check account + sender, materialise recipients/messages,
                 ONE wallet debit (ledger key (SMS_CHARGE, campaign, id)), queue messages
worker tick (every minute) ─► processCampaignBatches() ─► provider ─► results recorded
finalize() ─► COMPLETED when nothing is QUEUED; notifications once
```

### Approval change (Phase 5)

The recipient-count threshold (`sms.policy.reviewThresholdRecipients`, default 5,000) no longer holds
campaigns: routine campaigns are queued automatically. Still enforced: account suspension, sender-ID
approval, promotional consent/suppression/opt-out, platform blocklist (numbers, keywords, domains),
quiet hours, daily/monthly sending limits, wallet balance, provider restrictions, validation.
A campaign is held (`PENDING_REVIEW`, shown to customers as *Safety check*) only when:

| Rule | Setting (`campaign.processing.risk`) | Default |
|---|---|---|
| Link shortener in the text | — | on |
| Link + "verify/confirm … account/PIN/password/OTP/card" | — | on |
| New account sending to many | `newAccountDays`, `newAccountMaxRecipients` | 3 days, 500 |
| Very large transactional send | `transactionalBulkThreshold` | 2,000 |
| Account flagged by staff | Organization `requireCampaignReview` | off |
| Size hold | `holdAboveRecipients` | 0 (off) |

Held campaigns raise a staff alert (`staff.campaign_risk`). The existing admin review endpoint is
kept for them.

## 2. Batches

- `campaigns.batchSize` — chosen by the customer from `allowedBatchSizes` (10, 100), default
  `defaultBatchSize` (100). Anything else is refused.
- `processCampaignBatches(maxBatchesPerTick)` picks `PROCESSING` campaigns of active organizations,
  oldest `lastBatchAt` first (round robin, so one big campaign does not starve others), and for
  each: takes a per-campaign cache lock, claims up to `batchSize` due messages of that campaign,
  increments `campaigns.currentBatch`, stamps `messages.batchNumber`, and dispatches.
- A batch is sent in **chunks of the provider concurrency** (`providerConcurrency[provider]`,
  default 5, hard cap 20) — batch size never overrides provider limits. Optional `throttleMs`
  between chunks. Automas additionally caps its own HTTP pool at 5.
- Non-campaign messages (API / single sends) keep the old path (`processQueue`, campaign-less only).

## 3. Claiming and idempotency (MariaDB 10.4 safe)

No `SKIP LOCKED`, no `UPDATE … RETURNING`:

1. Non-locking read of due candidates (`QUEUED`, `provider IS NULL`, `nextAttemptAt <= now`, lease
   free, campaign `PROCESSING`, organization `ACTIVE`).
2. Short transaction: `SELECT … FOR UPDATE` by primary key in id order, re-check, set
   `lockedUntil` (lease, 120 s) and `attempts + 1`. The dispatcher remembers the exact lease value.
3. Before each chunk the remaining leases are extended (`lockedUntil = old` → new), so slow
   chunks never let a lease expire under a running worker.
4. **In-flight marker**: right before the HTTP call `provider` and `providerRequestedAt` are set —
   only on rows still holding *this worker's* lease value. Only those rows are sent.

Consequences: two workers can never send the same message; a message whose lease expired before the
marker was written was certainly not sent and is retried; one whose marker was written but whose
answer was never recorded is **UNKNOWN**.

## 4. Pause, resume, cancel

| Action | Effect |
|---|---|
| Pause (`PROCESSING → PAUSED`, `pausedAt`, `pausedById`) | Claims stop immediately. The dispatcher re-checks the status before each chunk: requests already at the provider finish and are recorded; leased-but-unsent messages are released (`lockedUntil = NULL`, attempt undone). |
| Resume (`PAUSED → PROCESSING`, `resumedAt`) | Re-checks account and sender approval. Continues with the next `QUEUED` message; accepted messages are never resent; nothing is charged again (the charge happened once at launch). |
| Cancel (`cancelledAt`, `cancelledById`, `cancelReason`) | Messages that never left the platform (`QUEUED`, `provider IS NULL`) are cancelled and refunded through the ledger (`(REFUND, message, id)`, once). In-flight messages are left to reach their real outcome. UNKNOWN messages are not refunded. History is kept. |

## 5. Provider responses (Phase 6)

Recorded the moment the provider answers, for every message:

| Column | Meaning |
|---|---|
| `status` | `SUBMITTED` (accepted by provider), `REJECTED`, `FAILED`, `UNKNOWN`; `DELIVERED` only from a delivery report |
| `providerMessageId` | provider reference (shown to customers as *Provider reference*) |
| `providerStatusCode` | `ACCEPTED` or the provider/HTTP error code |
| `providerResponse` | redacted summary (keys like api_key/token/secret/password removed, phone numbers masked to the last 3 digits, ≤ 2 KB) — staff only |
| `providerRequestedAt` / `providerRespondedAt` | timestamps of the call |
| `message_events` | one row per status change (unique `dedupeKey`), with the same redacted payload — the status history |

Status mapping: pending = `QUEUED`; processing = `QUEUED` with a lease or in-flight marker;
accepted/submitted = `SUBMITTED`; delivered = `DELIVERED`; failed = `FAILED`/`EXPIRED`;
rejected = `REJECTED`; unknown/unconfirmed = `UNKNOWN`.

Delivery reports: providers with webhooks post to `/api/v1/webhooks/sms/{provider}`; the signature is
verified (`verifyWebhook`), the message is matched by `(provider, providerMessageId)`, the update is
idempotent (`dedupeKey`) and status only moves forward. Automas documents no delivery reports and no
webhooks: its messages stay *Accepted*, which is what the UI shows.

Reports, message history, campaign pages and exports read only the local tables — the provider API
is never called to build a report (covered by `CampaignBatchTest::test_reports_never_call_the_provider`).

## 6. Unknown outcomes and recovery

Ambiguous results (`SendSmsResult::unconfirmed`: read timeout, connection dropped after sending,
5xx after receipt, undocumented provider status) and interrupted sends (`failInterruptedSends`, the
recovery sweep every tick) become **UNKNOWN**: never retried, never refunded automatically,
`campaigns.unknownCount` incremented, staff alerted at completion (`staff.unconfirmed_messages`).

Staff resolve them in **Admin → Unconfirmed SMS** after checking the provider panel:
*Delivered* or *Accepted* (charge stays) or *Failed + refund* (SUPER_ADMIN, `admin:messages:resolve`,
audited, refund once via the ledger).

## 7. Counters and progress

`campaigns.queuedCount/submittedCount/deliveredCount/failedCount/unknownCount` are updated inside the
same transaction as each status change. `GET /app/campaigns/{id}/progress` computes live figures from
`messages` (total, processed, pending, processing, accepted, delivered, failed, cancelled, unknown,
current/total batches, percent). The remaining-time estimate is returned only while sending, after
three batches, and never after a pause (the rate would be wrong) — otherwise `null`.

## 8. Dynamic campaigns

`campaigns.kind = DYNAMIC`, `dynamicConfig` = {uploadId, fileName, rowCount, recipientColumn,
senderColumn, fields, missingValues, defaultSenderId}. At launch `DynamicSmsService::materialize()`
re-reads the private CSV and re-evaluates every row (approvals and opt-outs may have changed since
submission); each message gets its own rendered body, sender, segments and price. The template stays
in `campaigns.message`, the row values in `campaign_recipients.variables`, the text in `messages.body`.

## 9. Notifications

Customer: campaign started / paused / resumed (`campaign.lifecycle`), completed, finished with failed
or unconfirmed messages (`campaign.partial`), could not start. Staff: campaign held by a risk control,
unconfirmed messages. Each is emitted on a conditional state transition that happens once, so a
retried job never sends a duplicate.

## 10. Settings (Admin → Campaign processing, `campaign.processing`)

`defaultBatchSize`, `allowedBatchSizes`, `maxDynamicRows`, `maxBatchesPerTick`, `throttleMs`,
`providerConcurrency`, `risk.*`. Values are clamped to non-editable hard limits in
`config/smsflow.php` (`hardMaxBatchSize` 500, `hardMaxConcurrency` 20, `hardMaxDynamicRows` 200,000).
Changes are audited with before/after.
