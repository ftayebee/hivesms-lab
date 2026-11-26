# 24. SMS report import

Super admins can import SMS delivery reports from a CSV file into a customer's message log. Use it
for SMS that were sent outside this platform (another panel, the provider's portal) so the customer
sees one complete history in **Reports**, the **message log**, message details and report exports.

## Switching it on

The module ships disabled, like the other Laravel-only modules (docs/23).

| Where | Setting |
| --- | --- |
| Laravel (`backend/.env`) | `FEATURE_REPORT_IMPORT=true` |
| Next.js | add `reportImport` to `LARAVEL_FEATURES`, e.g. `LARAVEL_FEATURES=all,dynamicSms,manualTopups,senderCatalog,reportImport` |
| Database | `php artisan migrate` (migration `2026_11_26_000001_report_imports`) |

Permission: `admin:reports:import` — **SUPER_ADMIN only**, because an import can charge a wallet.
The menu entry is **Admin → Report import**.

## Template

**Download template** on the page (`GET /api/v1/admin/report-imports/template`) gives a CSV
(UTF-8 with BOM, so Excel shows Bangla correctly):

| Column | Required | Notes |
| --- | --- | --- |
| Sender ID | yes | Masking name or number, max 20 characters. All digits → non-masking, otherwise masking. |
| Mobile Number | yes | Bangladesh mobile, any common format (01…, 8801…, +880…). |
| Message | yes | The SMS text, max 2,000 characters. Segments and encoding are calculated. |
| Sent At | yes | Asia/Dhaka time unless an offset is given. `2026-11-20 14:30`, `2026-11-20 14:30:00`, `20/11/2026 2:30 PM`, `20-11-2026 14:30`, `20 Nov 2026 14:30`, ISO-8601 and Excel date numbers are accepted. Day/month order is always **day first** for `/`, `-` and `.` dates. |
| Status | no | Delivered (default when empty), Sent, Failed, Rejected, Expired. Common synonyms (success, submitted, undelivered…) are recognised. |
| SMS Type | no | Transactional (default) or Promotional. |
| Delivered At | no | Defaults to Sent At for delivered rows. |
| Error | no | Failure reason shown on the message. |
| Reference | no | Stored as the client reference. |
| Cost | no | BDT for this SMS. When empty: segments × the customer's plan rate (failed/rejected/expired rows cost 0 while the SMS policy refunds failed messages). |

Header names are matched case-insensitively and ignore spaces, `_` and `-`; common alternatives
work too (`Phone`, `Number`, `SMS`, `Text`, `Date`, `Time`, `Sender`, `Mask`, `Price`…). Comma,
semicolon and tab separated files are accepted. Limits: 10 MB and 50,000 rows per file.

## Flow

1. Choose the customer and the file, then **Check file**. The preview writes nothing: it shows rows
   to import, rows that will be skipped (with line number and reason), segments, total cost, the
   wallet balance and the first 20 rows exactly as they will be stored.
2. Choose whether to **charge the wallet**, add an optional note, confirm with your password and
   **Import**.

Rows with problems are skipped, never imported half-filled. The valid rows, the wallet charge, the
import record and the audit log entry (`admin.report.import`) are written in **one database
transaction**: either everything is imported (and charged) or nothing is. If the wallet does not
have enough balance the import is refused; top up first or import without charging.

## What gets stored

* One `messages` row per valid CSV row with `source = IMPORT`, the final status, `createdAt` /
  `submittedAt` = Sent At, and one `message_events` row ("Imported from report"). Imported messages
  have no provider and are never `QUEUED`, so the worker never sends them and delivery polling
  ignores them.
* One `report_imports` row (file name, SHA-256, counts, cost, whether it was charged, wallet
  transaction id, note).
* When charged: one wallet transaction, `SMS_CHARGE`, reference `report_import` / import id.

The same file (by SHA-256) can be imported into the same customer only once.

## Undoing an import

There is no one-click undo. To reverse one: delete its messages
(`DELETE FROM messages WHERE source = 'IMPORT' AND organizationId = ? AND createdAt BETWEEN …`,
check the count first — the import's line numbers are in each message event's description), then
credit the charged amount back with **Admin → Customers → Wallet adjustment**, giving the import id
as the reason.

## Rollback

`php artisan migrate:rollback` refuses while messages with `source = IMPORT` exist. Remove
`reportImport` from `LARAVEL_FEATURES` and set `FEATURE_REPORT_IMPORT=false` to hide the module
without touching data.
