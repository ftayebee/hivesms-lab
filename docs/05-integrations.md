# 05 · Provider integrations and replacement guide

SMSFlow BD talks to four kinds of external services through small interfaces. The rest of the
platform (pricing, wallet, compliance, campaigns, reports, public API) depends only on these interfaces,
so connecting a real provider means writing **one adapter** and registering it.

| Kind | Interface | Registry | Adapters today |
|---|---|---|---|
| SMS | `SmsProvider`: `src/services/sms/types.ts` | `src/services/sms/index.ts` | `mock` (working simulator), `automas` (**unverified until tested with a real key**), `http` (**unverified scaffolding**) |
| Payments | `PaymentProvider`: `src/services/payments/types.ts` | `src/services/payments/index.ts` | `mock` (dev/staging only), `manual` (working), `sslcommerz` (**unverified**) |
| Email | `EmailProvider`: `src/services/email/index.ts` | same file | `console` (dev: writes files), `http` (**unverified**) |
| File storage | `StorageProvider`: `src/services/storage/index.ts` | same file | `local` (disk), `s3` (S3-compatible, SigV4 via `aws4fetch`) |

**"Unverified" means exactly that.** These adapters were written from general knowledge of
common API shapes and have **not** been tested against the provider's sandbox or production API. Each one
exposes `verified = false`, and the UI labels it as an unverified integration. Flip it to `true`
only after completing the verification checklist at the end of this document.

---

## 1. SMS providers

### Contract

```ts
interface SmsProvider {
  key: string; displayName: string; verified: boolean;
  sendSms(input: SendSmsInput): Promise<SendSmsResult>;
  sendBulkSms(inputs: SendSmsInput[]): Promise<SendSmsResult[]>;
  getDeliveryStatus(providerMessageId: string): Promise<DeliveryStatusResult>;
  getBalance(): Promise<ProviderBalance | null>;
  validateSenderId(senderId: string, type: SenderType): Promise<SenderIdValidation>;
  verifyWebhook(req: WebhookRequest): Promise<boolean>;
  parseDeliveryWebhook(req: WebhookRequest): Promise<ParsedDeliveryEvent[]>;
  parseInboundWebhook?(req: WebhookRequest): Promise<InboundSms[]>;
}
```

What the pipeline does with your adapter:

- **Sending.** The dispatcher claims queued messages and calls `sendSms`/`sendBulkSms`. It
  passes our message id as `reference`; forward it as the provider's client reference if the provider supports one.
  - Return `{ ok: true, providerMessageId }` when the provider **accepted** the message.
  - Return `{ ok: false, retryable: true }` for temporary errors (timeouts, 5xx, throttling). The message is
    retried with exponential backoff and the customer is not refunded.
  - Return `{ ok: false, retryable: false }` for permanent rejections (invalid number, blocked sender). The message becomes
    `REJECTED` and the charge is refunded automatically.
- **Delivery reports.** Providers call `POST /api/v1/webhooks/sms/<key>`. The route calls
  `verifyWebhook` first and answers **401** if it returns false, so never accept unsigned reports.
  Then `parseDeliveryWebhook` maps the payload to events. Give each event a stable `eventKey`: replays with the same key are ignored.
  Status changes only move forward (a late `SUBMITTED` never overwrites `DELIVERED`), and failures refund exactly once.
- **Polling fallback.** Messages stuck in `SUBMITTED` are polled with `getDeliveryStatus`. After
  72 hours they become `EXPIRED`, without a refund, because the provider accepted them.
- **Inbound SMS** (optional). `POST /api/v1/webhooks/sms/<key>/inbound` → `parseInboundWebhook`.
  Opt-out keywords (Admin → Settings) add the number to the suppression list of every
  organization that has messaged it. With a shared inbound number, the reply can't be tied to one
  sender, so suppressing for all of them is the safe choice.

Map provider statuses conservatively. When in doubt, `UNKNOWN` leaves the message as it is;
never report `DELIVERED` unless the operator actually confirmed delivery.

### Adding a provider

1. Create `src/services/sms/<name>-provider.ts` implementing `SmsProvider`, with `verified = false`.
2. Register it in the `switch` in `getSmsProvider()`, and add it to `SMS_PROVIDER_OPTIONS` so admins can
   select it in **Admin → Settings → SMS provider**.
3. Load credentials with `getSecretSetting("sms.provider.apiKey", process.env.SMS_PROVIDER_API_KEY)`.
   The admin UI stores them encrypted, and env vars are the fallback.
4. Handle number formats. The platform stores E.164 (`+8801XXXXXXXXX`), and many local gateways want
   `8801XXXXXXXXX` or `01XXXXXXXXX`.
5. Pass `encoding` through. Bangla text is `UCS2`, and most gateways need a "unicode" flag or type parameter.
   Segment counts and pricing are computed by the platform (`src/lib/sms-segments.ts`) and do not
   depend on the provider.
6. Add unit tests with recorded provider responses (see `tests/unit/providers.test.ts`).
7. Complete the verification checklist, then set `verified = true`.

### The `automas` adapter

`src/services/sms/automas-provider.ts` targets [Automas Technologies](https://sms.automas.com.bd/api).
Set `SMS_PROVIDER=automas`, `SMS_PROVIDER_API_KEY` and `SMS_DEFAULT_SENDER_ID`, or use Admin → Settings.
The endpoint is fixed, so `SMS_PROVIDER_URL` is ignored.

- **Sender IDs.** Automas rejects any sender ID not approved on your Automas account (status 102),
  and the message is refunded. Approve a customer's sender ID at Automas before approving it here.
- **IP allowlist.** If your account restricts API access by IP, allow your server's outgoing IP.
  Otherwise sends return status 108.
- **Status handling.** Message faults (101, 102, 105, 110, 111) are final and refunded. Account and
  upstream problems (103, 104, 106–109, 1000, 2000, 2300, 2400, 3000, 3300, 4000) are retried with
  backoff, then fail with a refund. Fix the account quickly, because customers' messages are waiting on it.
- **Possible duplicates.** The API has no client reference, so a message that times out after
  Automas accepted it is sent again on retry. Unreadable replies are not retried, for the same reason.
- **No delivery reports.** Automas documents no webhooks and no status API. The adapter declares
  `hasDeliveryReports = false`, so messages stay `SUBMITTED` (shown as "Sent") and never become
  `DELIVERED`, delivered counts stay 0, and no `message.delivered` webhook is sent. They are not
  expired after 72 hours, since that would report every send as failed. Webhook requests get 401.
- **No balance API.** The documented balance URL is the send endpoint, so `getBalance` returns
  `null`. Watch the balance in the Automas panel: an empty balance shows up as status 1000.
- **Long messages.** The documentation is ambiguous about multi-part GSM-7 messages, so check that
  they concatenate correctly on a handset (see the checklist below).

Check credentials and a sender ID with one real message, which uses real SMS balance:

```bash
npm run sms:test -- 8801XXXXXXXXX YOUR_SENDER_ID "Test message"
```

### The generic `http` adapter

`src/services/sms/http-provider.ts` covers the common "POST api_key, to, message, sender_id → JSON"
shape. The parameter names are configurable in Admin → Settings (mapping). Webhooks are verified by
an `X-Signature` header (hex HMAC-SHA256 of the raw body, using `SMS_PROVIDER_WEBHOOK_SECRET`) or,
for providers that cannot sign requests, a `?token=` query parameter equal to the secret. Review
`interpretSendResponse` and `parseDeliveryWebhook` against your provider's documentation. Response
success flags and delivery-report formats differ between providers.

### The `mock` adapter (development and tests)

It sends nothing. Behaviour depends on the recipient number's last digits:

| Number ends with | Result |
|---|---|
| `0000` | Permanent rejection at submission (refunded) |
| `8888` | Temporary error (retried with backoff) |
| `9999` | Accepted, then reported `FAILED` (refunded) |
| anything else | Accepted, then `DELIVERED` after a few seconds |

---

## 2. Payment providers

### Contract

```ts
interface PaymentProvider {
  key: string; displayName: string; description: string; verified: boolean;
  createCheckout(req: CheckoutRequest): Promise<CheckoutResult>;   // redirect URL or manual instructions
  handleCallback?(req: CallbackRequest): Promise<CallbackResult>;  // verify with the provider, report outcome
}
```

The flow:
1. The customer picks a package or amount. The platform computes VAT and bonus and creates a `PENDING` payment.
2. `createCheckout` returns a redirect URL to the gateway, or instructions (manual transfer).
3. The gateway calls back to one of two routes:
   - `/api/v1/payments/<key>/return` (the browser redirect)
   - `/api/v1/webhooks/payments/<key>` (server-to-server IPN)

   Both go through `handleCallback`.
4. **Your `handleCallback` must verify the result with the provider's server** (validation or
   query API), not trust the callback parameters. It must return `confirmedAmount`.
5. `completePayment` checks that the confirmed amount equals the expected total, then atomically:
   - credits the wallet once (repeated or concurrent callbacks are no-ops)
   - writes the ledger entry
   - issues a numbered VAT invoice.
6. Unverified "failed" or "cancelled" callbacks never change a payment's state. Otherwise anyone could cancel
   someone else's pending payment. Stale pending payments expire after 48 hours.

### Adding bKash, Nagad, a card gateway or another aggregator

1. Implement `PaymentProvider` in `src/services/payments/providers.ts` or a new file, with `verified = false`.
2. Add its key to `PAYMENT_PROVIDER_KEYS` and to the `switch` in `getPaymentProvider()`.
3. Add its settings (merchant id, secrets via `getSecretSetting`) to the payment settings in
   `src/services/settings.ts` and to Admin → Settings.
4. Use `req.paymentId` as the merchant transaction id, so callbacks can be matched.
5. Enable it through `PAYMENT_PROVIDERS` or Admin → Settings.
6. Test it in the provider's sandbox against the checklist below.

### SSLCommerz adapter (unverified)

The `sslcommerz` adapter implements the session-init plus validation-API pattern. It uses the sandbox
by default and live only when `PAYMENT_PROVIDER_LIVE=true`. It was **not** tested against the
SSLCommerz sandbox. Before enabling it:
- confirm the field names, the IPN behaviour and the validation response against the current SSLCommerz documentation
- confirm your store's credentials and whitelisted URLs.

### Manual transfer

`manual` shows your bank or mobile-wallet instructions (Admin → Settings). The customer submits a
transaction reference, and an admin verifies it in **Admin → Payments** before credits are added.
It works without any gateway contract.

---

## 3. Email

```ts
interface EmailProvider { key: string; send(m: EmailMessage): Promise<{ ok: boolean; id?: string; error?: string }> }
```

- `console` (development) writes each email to `LOCAL_DATA_DIR/mailbox/*.html` and sends nothing.
- `http` (unverified) POSTs `{ from, to, subject, html, text }` as JSON with
  `Authorization: Bearer EMAIL_PROVIDER_KEY` to `EMAIL_PROVIDER_URL`. Some services accept this shape
  directly; for others, write an adapter.

Email failures are logged, and they never break the triggering action (registration, password reset,
receipts). For production, configure SPF, DKIM and DMARC for the `EMAIL_FROM` domain.

---

## 4. File storage

```ts
interface StorageProvider {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: Buffer; contentType: string } | null>;
  delete(key: string): Promise<void>;
}
```

Stored files are sender-ID supporting documents. Uploads are checked by size and **magic bytes**
(PDF, PNG, JPEG), not by the declared type. Files are served only through authenticated routes
that check tenant ownership or admin permission, and are never served from a public bucket.

- `local` stores files under `LOCAL_DATA_DIR/storage`. It suits a single instance with a persistent volume.
- `s3` works with any S3-compatible service (AWS S3, Cloudflare R2, MinIO, DigitalOcean Spaces) via `STORAGE_S3_*`.
  Keep the bucket private.

---

## 5. Verification checklist (before setting `verified = true`)

- [ ] Read the provider's current API documentation, and record its version or date in the adapter's comment.
- [ ] Sandbox or test credentials work, and the credentials are stored via Admin → Settings or env, never in code.
- [ ] **SMS:**
  - [ ] English (GSM-7) and Bangla (UCS-2) messages arrive intact on real handsets on at least two operators.
  - [ ] Multi-part messages concatenate correctly.
  - [ ] Masking and non-masking senders behave as the operator requires.
  - [ ] Delivery reports arrive, pass signature verification, map to the right statuses and are deduplicated.
  - [ ] Permanent and temporary errors are classified correctly (check the refunds and retries).
- [ ] **Payments:**
  - [ ] Success, failure and cancel in the sandbox.
  - [ ] Amount tampering is rejected.
  - [ ] Replayed IPNs credit only once.
  - [ ] The validation API is called on every success.
- [ ] Timeouts are handled: no double sends and no double credits.
- [ ] Logs contain no secrets or full phone numbers.
- [ ] Unit tests cover response parsing with recorded payloads.
