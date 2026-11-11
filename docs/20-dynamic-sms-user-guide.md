# 20 — Dynamic SMS: user guide

Dynamic SMS sends **one personalised message per row of a CSV file**: each recipient gets the
values of their own row. It lives in the sidebar under **Send SMS → Dynamic SMS**
(`/dashboard/dynamic-sms`). Regular SMS (one message for groups or pasted numbers) is unchanged.

> Availability: the module ships switched off. It appears once the operator enables it (docs/23).

## 1. Prepare the CSV

- First row = column headers. Every column needs a unique name (letters, numbers, spaces and
  `- _ . / # ( ) &`, up to 64 characters; Bangla headers are fine).
- Save as **CSV UTF-8** (Excel: *File → Save As → CSV UTF-8 (Comma delimited)*). UTF-8 with or
  without BOM is accepted; other encodings are refused so Bangla text is never garbled.
- Comma, semicolon or tab separators are detected from the header row.
- Limits: 10 MB and 50,000 rows by default (the operator can change the row limit).
- Empty rows are ignored and counted. A row with more cells than headers is *malformed* and skipped.

Download the template from the page (**Download template**):

| Retail Name | Mobile Number | Due Amount | Invoice |
|---|---|---|---|
| Rahim Store | 01712345678 | 1500 | INV-001 |
| Karim Traders | 01812345678 | 2500 | INV-002 |

## 2. Map the columns

- **Recipient phone number column** — required, chosen explicitly. Any Bangladeshi mobile format
  works (`017…`, `88017…`, `+88017…`); invalid numbers are skipped and counted.
- **Sender ID column** — optional. Each row must name a sender ID **approved for your account**;
  any other value skips that row. An empty cell uses the sender ID selected in the composer.
- **Rows with a missing value** — *Skip those rows* (default) or *Stop: don't send the campaign*.
  A row is never sent with a blank where a value belongs.

The recipient column and the sender-ID column are **not** available as message fields.

## 3. Write the message

Click a field chip to insert `{{Column Name}}` at the cursor:

```
Dear {{Retail Name}},
Your outstanding amount is BDT {{Due Amount}}.
Invoice: {{Invoice}}
```

Field names are matched case-insensitively. Unknown fields (a typo, or the phone/sender column) are
rejected before anything is sent.

Pick the message type (transactional/promotional), the batch size (10 or 100 by default), and send
now or schedule.

## 4. Preview

**Preview messages** renders every row on the server. Step through rows with the arrows to see the
recipient, sender ID, final text, segments, encoding and cost of each one. The statistics show total
rows, valid recipients, invalid numbers, duplicates (a number that already appeared earlier in the
file), missing values, unapproved sender IDs, opted-out/blocked numbers, total segments and the
estimated cost. Segments are counted **after** personalisation, so longer values cost more; Bangla
switches a message to Unicode (70 characters per SMS, 67 per part).

## 5. Confirm

**Review and send** shows the final summary — campaign name, message type, recipients, sender ID,
fields used, segments, number of batches, estimated cost and wallet balance — and requires you to
tick the confirmation box. Nothing is charged until sending starts; then the wallet is charged once
for all valid rows. Skipped rows are never charged.

A campaign is queued straight away. Only a genuinely risky campaign (for example a link shortener
asking recipients to "verify" their account, a large send from a brand-new account, or an account
our team has flagged) waits for a safety check; you are told why on the confirmation screen.

## 6. Follow the campaign

The campaign page shows batch progress: processed, **accepted by the provider**, delivered, failed,
**unconfirmed**, pending, the current batch and — once it can be estimated reliably — the remaining
time. You can **pause** (the current provider requests finish; nothing new starts), **resume**
(continues with the next unsent message; nobody receives a message twice and nothing is charged
again) or **cancel** (with an optional reason; never-sent messages are refunded).

- *Accepted* = the provider took the message. *Delivered* needs a delivery report; our current
  provider sends none, so accepted is the last known status.
- *Unconfirmed* = the provider did not answer (timeout, connection drop). Such messages are never
  resent automatically (that could deliver them twice) and stay charged until our team checks the
  provider records and resolves them.

The per-recipient CSV export contains the rendered message, sender ID, batch, provider reference and
provider code of every row. Cells that start with `=`, `+`, `-` or `@` are prefixed with `'` so a
spreadsheet never runs them as formulas.

## Privacy

The uploaded file is stored privately for your organization only and deleted automatically after
the campaign has launched (or after 24 hours if it is never used). Row values are kept with the
campaign recipients so reports and support can see what each person received.
