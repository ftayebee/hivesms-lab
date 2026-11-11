# 22 — Manual payments and sender catalog: operations

## 1. Payment receiving details (Super Admin)

**Admin → Payment methods** (`/admin/payment-methods`, permission `admin:settings:manage` =
SUPER_ADMIN only). Each method: type (bKash, Nagad, Rocket, bank, other), display name, receiving
number/account, account type, holder name, bank/branch/routing (bank), customer instructions,
QR/instruction image (PNG/JPG, ≤ 5 MB, checked by MIME sniffing and magic bytes, stored privately),
min/max top-up, "require proof", "require sender number", active, display order (arrows).

- Every save, removal and QR change asks for **your current password** (a changed account number
  redirects customers' money, so a stolen session is not enough; 5 wrong passwords lock privileged
  actions for 15 minutes).
- Every change is audited with before/after values (`payment_method.*` in Audit logs).
- Removing a method hides it; existing requests keep pointing at it.
- Enter only accounts you have verified. The platform never assumes an account number.

## 2. What customers see

On **Wallet → Pay manually**: active methods only, with receiving details, copy buttons, QR and
limits. They pay outside the platform, then submit: method, top-up amount (VAT is added and shown),
transaction ID, number paid from, payment date/time, optional (or required) screenshot/PDF, note.

Nothing is credited on submission. The customer sees the submission reference (`MP-XXXXXXXX`),
amount, method, date, transaction ID, status (pending / under review / approved / rejected /
cancelled) and the rejection reason. They can cancel a request until it is under review. Proof files
are private to their organization (`orgs/<org>/payment-proofs/…`).

Limits: at most 5 open requests per customer; the same transaction ID twice from one account is
refused. Signals for reviewers (never shown to the customer): the transaction ID already used by
another account, an amount at/above the review threshold (default BDT 100,000), 3+ rejections in a
week. Such requests also raise a `staff.payment_suspicious` alert.

## 3. Reviewing requests

**Admin → Manual payments** (`/admin/topups`). Filters: status, date range, method, customer or
transaction ID search. ADMIN and SUPER_ADMIN can view, open proofs (every view is audited), *Mark
under review* and add internal notes. Only **SUPER_ADMIN** approves or rejects.

Before approving, check the receiving account statement/app for the transaction. Then, on the
request page:

1. Type the **amount actually received** — it must equal the request total.
2. Type the **transaction ID as shown on the receiving account** — it must match the request.
3. Confirm with your password → **Approve and credit wallet**.

What happens (one database transaction, `PaymentService::complete`): the request row is locked, its
status must still be pending/under review, it becomes `SUCCEEDED`, the wallet is credited through the
ledger (unique key `(TOPUP, payment, id)`), an invoice is issued (unique per payment), the audit log
and the customer notification are written. A second approval — by you or another admin, or a
double click — is refused (`409`), and the same transaction ID can never be credited to two requests
(`providerRef` is unique). Staff who are members of the paying organization cannot decide on it.

**Reject** requires a reason (shown to the customer) and your password, and never credits anything.

The legacy one-click approve on **Admin → Payments** refuses these requests and points here.

## 4. Status reference

| API `status` | `payments.status` |
|---|---|
| pending | `AWAITING_VERIFICATION` |
| under_review | `UNDER_REVIEW` |
| approved | `SUCCEEDED` |
| rejected | `FAILED` |
| cancelled | `CANCELLED` |

## 5. Provider sender catalog

**Admin → Sender catalog** (`/admin/sender-catalog`, SUPER_ADMIN). The catalog lists the sender IDs
available on the SMS provider account; assign each to any number of customers.

- **Sync from provider** imports the provider's list when its API offers one. **Automas documents
  no sender-ID listing endpoint** (its sender IDs are managed in its web panel), so with Automas the
  sync button answers "offers no API" and entries are added by hand (**Add manually**) after the ID
  is approved on the Automas panel. The mock provider returns a fixed sample for testing.
- **Assign**: pick customers and **Save**. Each assigned customer gets an `APPROVED` sender ID
  (default if they had none), usable immediately — including in Dynamic SMS sender columns. No
  sender-ID fee is charged for platform-assigned IDs.
- **Unassign** suspends only the rows the catalog created; a sender ID a customer obtained through
  their own approved request is never suspended by the catalog.
- Every sync, addition, activation change and assignment is audited; customers are notified.

## 6. Settings (Admin → Campaign processing)

Manual payment rules: proof file limit (0.1–10 MB), open requests per customer, the amount from which
requests are flagged. Audited with before/after.
