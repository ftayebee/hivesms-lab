import Link from "next/link";
import { ApiCodeBlock, type CodeSample } from "@/components/docs/code-block";
import { Callout, CodeWrap, Endpoint, H2, ParamTable } from "@/components/docs/doc-parts";
import { siteConfig } from "@/config/site";
import {
  balanceSamples,
  bulkSmsSamples,
  errorResponseJson,
  sendSmsResponseJson,
  sendSmsSamples,
  statusSamples,
  webhookPayloadJson,
  webhookVerifySamples,
} from "./api-samples";
import { errorCodeList, publicEndpoints } from "./api-reference";

/**
 * Developer documentation. Each page declares its own table of contents (ids must match H2 ids).
 */
export interface DocPage {
  slug: string; // "" = introduction
  title: string;
  description: string;
  group: "Getting started" | "Sending" | "Tracking" | "Reference";
  toc: { id: string; title: string }[];
  Content: () => React.ReactNode;
}

const BASE = siteConfig.apiBaseUrl;

const listMessagesSamples: CodeSample[] = [
  { label: "cURL", language: "bash", code: `curl "${BASE}/messages?status=failed&from=2026-09-01&limit=50" \\\n  -H "Authorization: Bearer $SMSFLOW_API_KEY"` },
];
const estimateSamples: CodeSample[] = [
  {
    label: "cURL",
    language: "bash",
    code: `curl -X POST ${BASE}/sms/estimate \\\n  -H "Authorization: Bearer $SMSFLOW_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{ "message": "প্রিয় গ্রাহক, আপনার অর্ডারটি আজ ডেলিভারি হবে।", "recipients": 250, "type": "promotional" }'`,
  },
  {
    label: "Response",
    language: "json",
    code: `{
  "success": true,
  "data": {
    "encoding": "UCS2",
    "characters": 44,
    "segments": 1,
    "recipients": 250,
    "sender_type": "MASKING",
    "rate": "0.5500",
    "estimated_cost": "137.50",
    "currency": "BDT"
  },
  "meta": { "requestId": "req_..." }
}`,
  },
];
const senderIdSamples: CodeSample[] = [
  { label: "cURL", language: "bash", code: `curl ${BASE}/sender-ids -H "Authorization: Bearer $SMSFLOW_API_KEY"` },
  {
    label: "Response",
    language: "json",
    code: `{
  "success": true,
  "data": [
    { "sender_id": "YOURBRAND", "type": "masking", "status": "approved", "default": true, "approved_at": "2026-06-01T10:00:00.000Z" },
    { "sender_id": "YOUROFFER", "type": "masking", "status": "pending", "default": false, "approved_at": null }
  ],
  "meta": { "requestId": "req_..." }
}`,
  },
];

export const docPages: DocPage[] = [
  {
    slug: "",
    title: "Introduction",
    description: "Overview of the SMSFlow BD API: what you can do, base URL, conventions and environments.",
    group: "Getting started",
    toc: [
      { id: "what", title: "What you can build" },
      { id: "base-url", title: "Base URL and format" },
      { id: "conventions", title: "Conventions" },
      { id: "environments", title: "Environments" },
    ],
    Content: () => (
      <>
        <p>The {siteConfig.name} API lets your applications send SMS to Bangladeshi mobile numbers and track what happens to each message. It is a JSON REST API authenticated with API keys.</p>
        <H2 id="what">What you can build</H2>
        <ul>
          <li>One-time passwords and login verification (<Link href="/docs/send-sms">Send SMS</Link>).</li>
          <li>Order, payment and delivery notifications from your backend.</li>
          <li>Personalised batches of up to 1,000 recipients per request (<Link href="/docs/bulk-sms">Bulk SMS</Link>).</li>
          <li>Delivery tracking by polling or <Link href="/docs/webhooks">webhooks</Link>.</li>
        </ul>
        <p>Large marketing campaigns with contact groups, scheduling and review are easier from the dashboard&apos;s campaign builder.</p>
        <H2 id="base-url">Base URL and format</H2>
        <p>
          All endpoints live under <code>{BASE}</code>. Requests and responses use JSON (UTF-8). Every response has the same envelope: <code>success</code>, then either <code>data</code> or <code>error</code>, and <code>meta.requestId</code>, which you should log and quote when contacting support.
        </p>
        <CodeWrap>
          <ApiCodeBlock samples={[sendSmsResponseJson, errorResponseJson]} />
        </CodeWrap>
        <H2 id="conventions">Conventions</H2>
        <ul>
          <li>Phone numbers: any common Bangladeshi format is accepted (<code>01712345678</code>, <code>8801712345678</code>, <code>+880 1712-345678</code>) and returned in E.164 (<code>+8801712345678</code>).</li>
          <li>Money: strings with decimal places, in BDT (for example <code>&quot;0.35&quot;</code>), so no precision is lost.</li>
          <li>Time: ISO 8601 in UTC. The dashboard shows Asia/Dhaka time.</li>
          <li>IDs: UUIDs. Treat them as opaque strings.</li>
          <li>Enum values in responses are lower case (<code>queued</code>, <code>delivered</code>).</li>
        </ul>
        <H2 id="environments">Environments</H2>
        <p>
          The API is processed by this platform in every environment. Whether messages reach real handsets depends on the upstream SMS provider the platform operator has connected. Development and sandbox deployments use a mock provider that never sends real SMS and simulates results: numbers ending in <code>0000</code> are rejected, <code>9999</code> fail after submission, <code>8888</code> produce temporary errors, and everything else is delivered after a few seconds.
        </p>
      </>
    ),
  },
  {
    slug: "quick-start",
    title: "Quick start",
    description: "Send your first SMS through the API in five minutes.",
    group: "Getting started",
    toc: [
      { id: "account", title: "1. Create an account" },
      { id: "key", title: "2. Create an API key" },
      { id: "send", title: "3. Send a message" },
      { id: "status", title: "4. Check the status" },
      { id: "next", title: "Next steps" },
    ],
    Content: () => (
      <>
        <H2 id="account">1. Create an account and add balance</H2>
        <p>
          <Link href="/register">Register</Link>, verify your email, then add balance in Dashboard → Wallet. Every message is charged from your wallet, so a send with zero balance returns <code>INSUFFICIENT_BALANCE</code>.
        </p>
        <H2 id="key">2. Create an API key</H2>
        <p>
          Go to Dashboard → API → Create key. Select the <code>sms:send</code> and <code>messages:read</code> scopes. Copy the key immediately: it is shown only once. Store it as an environment variable, for example <code>SMSFLOW_API_KEY</code>.
        </p>
        <Callout tone="warning" title="Keep keys on your server">
          Never embed an API key in a mobile app, browser JavaScript or a public repository. Anyone with the key can send messages billed to your account.
        </Callout>
        <H2 id="send">3. Send a message</H2>
        <p>Replace the number with your own mobile number for the first test.</p>
        <CodeWrap>
          <ApiCodeBlock samples={sendSmsSamples} />
        </CodeWrap>
        <p>
          A <code>202 Accepted</code> response means the message is queued and charged. It is dispatched to the provider within seconds.
        </p>
        <H2 id="status">4. Check the delivery status</H2>
        <CodeWrap>
          <ApiCodeBlock samples={statusSamples} />
        </CodeWrap>
        <H2 id="next">Next steps</H2>
        <ul>
          <li>
            Receive statuses automatically with <Link href="/docs/webhooks">webhooks</Link> instead of polling.
          </li>
          <li>
            Request a branded <Link href="/docs/sender-ids">sender ID</Link>.
          </li>
          <li>
            Handle <Link href="/docs/error-codes">errors</Link> and <Link href="/docs/rate-limits">rate limits</Link> in your client.
          </li>
        </ul>
      </>
    ),
  },
  {
    slug: "authentication",
    title: "Authentication",
    description: "Authenticate with Bearer API keys, scopes, IP allowlists and key rotation.",
    group: "Getting started",
    toc: [
      { id: "bearer", title: "Bearer keys" },
      { id: "scopes", title: "Scopes" },
      { id: "restrictions", title: "IP allowlist and expiry" },
      { id: "rotation", title: "Rotating keys" },
      { id: "auth-errors", title: "Authentication errors" },
    ],
    Content: () => (
      <>
        <H2 id="bearer">Bearer API keys</H2>
        <p>
          Send your key in the <code>Authorization</code> header on every request:
        </p>
        <CodeWrap>
          <ApiCodeBlock samples={[{ label: "Header", language: "http", code: "Authorization: Bearer sfk_live_ab12cd34_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" }]} />
        </CodeWrap>
        <p>
          Keys start with <code>sfk_live_</code> followed by an 8-character identifier (visible in the dashboard, so you can tell keys apart) and a secret. We store only a keyed hash of the full key; it cannot be recovered, only replaced.
        </p>
        <H2 id="scopes">Scopes</H2>
        <ParamTable
          title="Scopes"
          params={[
            { name: "sms:send", type: "scope", description: "Send single and bulk SMS, and estimate cost." },
            { name: "messages:read", type: "scope", description: "Read message status and history." },
            { name: "balance:read", type: "scope", description: "Read wallet balance and rates." },
            { name: "sender_ids:read", type: "scope", description: "List sender IDs." },
          ]}
        />
        <p>Give each service only what it needs. A reporting job does not need <code>sms:send</code>.</p>
        <H2 id="restrictions">IP allowlist and expiry</H2>
        <p>When creating a key you can list the IP addresses allowed to use it, and set an expiry date. Requests from other addresses are rejected with <code>403 FORBIDDEN</code>.</p>
        <H2 id="rotation">Rotating keys</H2>
        <ol>
          <li>Create a new key with the same scopes.</li>
          <li>Deploy it to your service.</li>
          <li>Confirm traffic uses the new key (the dashboard shows each key&apos;s last use).</li>
          <li>Revoke the old key. Revocation is immediate.</li>
        </ol>
        <H2 id="auth-errors">Authentication errors</H2>
        <ul>
          <li><code>401 INVALID_API_KEY</code>: the key is missing, wrong, revoked or expired.</li>
          <li><code>403 INSUFFICIENT_SCOPE</code>: the key lacks the scope this endpoint requires.</li>
          <li><code>403 FORBIDDEN</code>: IP not allowlisted, or the account is suspended.</li>
        </ul>
        <p>Repeated authentication failures from one IP address are rate limited.</p>
      </>
    ),
  },
  {
    slug: "send-sms",
    title: "Send SMS",
    description: "POST /api/v1/sms/send: send one message, with idempotency and scheduling.",
    group: "Sending",
    toc: [
      { id: "request", title: "Request" },
      { id: "response", title: "Response" },
      { id: "segments", title: "Segments and cost" },
      { id: "idempotency", title: "Idempotency" },
      { id: "estimate", title: "Estimate before sending" },
    ],
    Content: () => (
      <>
        <Endpoint method="POST" path="/api/v1/sms/send" scope="sms:send" />
        <H2 id="request">Request</H2>
        <ParamTable
          params={[
            { name: "to", type: "string", required: true, description: "Bangladeshi mobile number in any common format." },
            { name: "message", type: "string", required: true, description: "Message text, up to 10 segments (about 1,530 GSM-7 characters or 670 Unicode characters)." },
            { name: "sender_id", type: "string", description: "An approved sender ID of your account. Defaults to your default sender, or the shared non-masking number." },
            { name: "type", type: "\"transactional\" | \"promotional\"", description: "Defaults to transactional. Promotional messages skip opted-out recipients and respect quiet hours." },
            { name: "reference", type: "string", description: "Your own reference (max 100 characters), returned in webhooks." },
            { name: "schedule_at", type: "ISO 8601 string", description: "Send later, up to 30 days ahead. Charged when accepted." },
          ]}
        />
        <CodeWrap>
          <ApiCodeBlock samples={sendSmsSamples} />
        </CodeWrap>
        <H2 id="response">Response</H2>
        <p>
          <code>202 Accepted</code> with the message ID, status <code>queued</code>, segment count and the amount charged.
        </p>
        <CodeWrap>
          <ApiCodeBlock samples={[sendSmsResponseJson]} />
        </CodeWrap>
        <H2 id="segments">Segments and cost</H2>
        <p>
          The cost is <code>segments × rate</code>. Plain Latin text is GSM-7: 160 characters for one segment, 153 per segment when longer. Any Bangla or emoji character switches the whole message to Unicode: 70 characters, or 67 per segment. Characters such as <code>{"{ } [ ] ~ \\ | ^ €"}</code> count as two in GSM-7. Exact limits are set per provider by the platform operator.
        </p>
        <H2 id="idempotency">Idempotency</H2>
        <p>
          Network failures happen. Send an <code>Idempotency-Key</code> header (any unique string up to 255 characters, such as your order ID plus purpose). If you retry with the same key and the same body within 24 hours, you receive the original response with an <code>Idempotent-Replayed: true</code> header and no second message is sent. Reusing a key with a different body returns <code>409 IDEMPOTENCY_CONFLICT</code>.
        </p>
        <H2 id="estimate">Estimate before sending</H2>
        <Endpoint method="POST" path="/api/v1/sms/estimate" scope="sms:send" />
        <p>Returns encoding, segments and cost for a message without sending or charging anything.</p>
        <CodeWrap>
          <ApiCodeBlock samples={estimateSamples} />
        </CodeWrap>
      </>
    ),
  },
  {
    slug: "bulk-sms",
    title: "Bulk SMS",
    description: "POST /api/v1/sms/bulk: send up to 1,000 personalised messages in one request.",
    group: "Sending",
    toc: [
      { id: "request", title: "Request" },
      { id: "partial", title: "Partial acceptance" },
      { id: "campaigns", title: "When to use campaigns" },
    ],
    Content: () => (
      <>
        <Endpoint method="POST" path="/api/v1/sms/bulk" scope="sms:send" />
        <H2 id="request">Request</H2>
        <ParamTable
          params={[
            { name: "recipients", type: "array", required: true, description: "1 to 1,000 items: { to, message?, variables? }. A plain array of number strings is also accepted." },
            { name: "message", type: "string", required: true, description: "Default message. Supports {{variable}} placeholders filled from each recipient's variables." },
            { name: "sender_id", type: "string", description: "Approved sender ID." },
            { name: "type", type: "string", description: "transactional (default) or promotional." },
            { name: "reference", type: "string", description: "Your reference for the whole batch." },
            { name: "schedule_at", type: "ISO 8601 string", description: "Optional delayed send." },
          ]}
        />
        <CodeWrap>
          <ApiCodeBlock samples={bulkSmsSamples} />
        </CodeWrap>
        <H2 id="partial">Partial acceptance</H2>
        <p>
          Invalid numbers, duplicates, blocked numbers and (for promotional messages) opted-out numbers are returned in <code>errors</code> with a code per recipient. Valid recipients are still accepted and charged. If no recipient is valid, the request fails with <code>422</code> and nothing is charged. The balance check covers the whole accepted batch: if the total exceeds your balance, nothing is sent.
        </p>
        <H2 id="campaigns">When to use campaigns instead</H2>
        <p>For marketing sends to your contact groups, scheduled sends to thousands of numbers, or anything that needs review, use Dashboard → Campaigns. Campaigns resolve groups at send time, so recent opt-outs are respected.</p>
      </>
    ),
  },
  {
    slug: "delivery-reports",
    title: "Delivery reports",
    description: "Message statuses, the lifecycle, and how to read a message's history.",
    group: "Tracking",
    toc: [
      { id: "lifecycle", title: "Status lifecycle" },
      { id: "get", title: "Get a message" },
      { id: "list", title: "List messages" },
      { id: "failures", title: "Failures and refunds" },
    ],
    Content: () => (
      <>
        <H2 id="lifecycle">Status lifecycle</H2>
        <ParamTable
          title="Statuses"
          params={[
            { name: "queued", type: "initial", description: "Accepted and charged; waiting to be sent to the provider (or scheduled)." },
            { name: "submitted", type: "in progress", description: "Accepted by the upstream provider. Shown as \"Sent\" in the dashboard." },
            { name: "delivered", type: "final", description: "The provider reported delivery to the handset." },
            { name: "failed", type: "final", description: "Could not be delivered (e.g. unreachable handset), or failed after retries." },
            { name: "rejected", type: "final", description: "Refused by the provider or operator." },
            { name: "expired", type: "final", description: "No final report within the validity period (72 hours)." },
            { name: "cancelled", type: "final", description: "Cancelled before sending (e.g. a cancelled campaign)." },
          ]}
        />
        <p>Statuses only move forward. A late or repeated report never changes a final status.</p>
        <H2 id="get">Get a message</H2>
        <Endpoint method="GET" path="/api/v1/messages/{id}" scope="messages:read" />
        <CodeWrap>
          <ApiCodeBlock samples={statusSamples} />
        </CodeWrap>
        <H2 id="list">List messages</H2>
        <Endpoint method="GET" path="/api/v1/messages" scope="messages:read" />
        <ParamTable
          title="Query parameters"
          params={[
            { name: "status", type: "string", description: "Filter by status." },
            { name: "to", type: "string", description: "Filter by recipient number." },
            { name: "reference", type: "string", description: "Filter by your reference." },
            { name: "from / until", type: "date", description: "Created between these dates (UTC)." },
            { name: "limit", type: "1-100", description: "Page size, default 25." },
            { name: "cursor", type: "string", description: "Value of meta.nextCursor from the previous page." },
          ]}
        />
        <CodeWrap>
          <ApiCodeBlock samples={listMessagesSamples} />
        </CodeWrap>
        <H2 id="failures">Failures and refunds</H2>
        <p>
          Failed, rejected and cancelled messages are refunded to your wallet (see the <Link href="/refund-policy">refund policy</Link>). The response and webhook include <code>error_code</code> and <code>error_message</code> as reported by the provider.
        </p>
      </>
    ),
  },
  {
    slug: "webhooks",
    title: "Webhooks",
    description: "Receive signed delivery reports and campaign events on your own endpoint.",
    group: "Tracking",
    toc: [
      { id: "setup", title: "Setup" },
      { id: "events", title: "Events" },
      { id: "payload", title: "Payload" },
      { id: "verify", title: "Verifying signatures" },
      { id: "retries", title: "Retries" },
    ],
    Content: () => (
      <>
        <H2 id="setup">Setup</H2>
        <p>In Dashboard → API → Webhooks, add an HTTPS URL and choose events. The signing secret is shown once when you create the endpoint.</p>
        <H2 id="events">Events</H2>
        <ul>
          <li><code>message.delivered</code>: a message reached the handset.</li>
          <li><code>message.failed</code>: a message ended as failed, rejected, expired or cancelled.</li>
          <li><code>campaign.completed</code>: a campaign finished sending.</li>
        </ul>
        <H2 id="payload">Payload</H2>
        <CodeWrap>
          <ApiCodeBlock samples={[webhookPayloadJson]} />
        </CodeWrap>
        <H2 id="verify">Verifying signatures</H2>
        <p>
          Each request carries <code>X-SMSFlow-Signature: t=&lt;unix seconds&gt;,v1=&lt;hex&gt;</code>, where <code>v1</code> is HMAC-SHA256 of <code>t + &quot;.&quot; + raw body</code> using your endpoint secret. Compute it over the raw bytes, compare in constant time, and reject timestamps older than 5 minutes.
        </p>
        <CodeWrap>
          <ApiCodeBlock samples={webhookVerifySamples} />
        </CodeWrap>
        <H2 id="retries">Retries and ordering</H2>
        <p>Respond with a 2xx status within 10 seconds. Otherwise we retry with exponential backoff for up to 8 attempts. Events can arrive more than once and out of order: deduplicate on <code>id</code> and use <code>data.occurred_at</code> for ordering.</p>
      </>
    ),
  },
  {
    slug: "sender-ids",
    title: "Sender IDs",
    description: "Masking and non-masking sender IDs, approval process and the sender ID endpoint.",
    group: "Sending",
    toc: [
      { id: "types", title: "Masking and non-masking" },
      { id: "approval", title: "Approval process" },
      { id: "list", title: "List sender IDs" },
    ],
    Content: () => (
      <>
        <H2 id="types">Masking and non-masking</H2>
        <p>
          A <strong>masking</strong> sender ID shows a name such as <code>YOURBRAND</code> (usually 3 to 11 letters and digits). A <strong>non-masking</strong> sender shows a phone number. Accounts without an approved sender use the platform&apos;s shared non-masking number.
        </p>
        <H2 id="approval">Approval process</H2>
        <p>
          Request sender IDs in Dashboard → Sender IDs with the purpose, a sample message and supporting documents (for example a trade licence). Approval is decided by the upstream provider and mobile operators, and may be subject to regulatory requirements. Timelines vary and are not guaranteed. You are notified by email and in the dashboard when the status changes.
        </p>
        <Callout tone="info">Using a sender ID that is not approved returns <code>422 SENDER_ID_NOT_APPROVED</code>.</Callout>
        <H2 id="list">List sender IDs</H2>
        <Endpoint method="GET" path="/api/v1/sender-ids" scope="sender_ids:read" />
        <CodeWrap>
          <ApiCodeBlock samples={senderIdSamples} />
        </CodeWrap>
      </>
    ),
  },
  {
    slug: "error-codes",
    title: "Error codes",
    description: "Every error code the API returns, with HTTP status and meaning.",
    group: "Reference",
    toc: [
      { id: "format", title: "Error format" },
      { id: "codes", title: "All codes" },
      { id: "handling", title: "Handling errors" },
    ],
    Content: () => (
      <>
        <H2 id="format">Error format</H2>
        <CodeWrap>
          <ApiCodeBlock samples={[errorResponseJson]} />
        </CodeWrap>
        <p>
          <code>error.code</code> is stable and safe to branch on. <code>error.message</code> is for people and may change. Validation errors include <code>error.details.fields</code>.
        </p>
        <H2 id="codes">All codes</H2>
        <table>
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">HTTP</th>
              <th scope="col">Meaning</th>
            </tr>
          </thead>
          <tbody>
            {errorCodeList.map((e) => (
              <tr key={e.code}>
                <td>
                  <code>{e.code}</code>
                </td>
                <td>{e.status}</td>
                <td>{e.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <H2 id="handling">Handling errors</H2>
        <ul>
          <li>4xx errors other than 409 and 429 will not succeed if retried unchanged. Fix the request.</li>
          <li>For 429, wait for the <code>Retry-After</code> seconds.</li>
          <li>For 5xx and network errors, retry with backoff using the same <code>Idempotency-Key</code>.</li>
        </ul>
      </>
    ),
  },
  {
    slug: "rate-limits",
    title: "Rate limits",
    description: "Request rate limits, sending limits and the rate-limit headers.",
    group: "Reference",
    toc: [
      { id: "limits", title: "Default limits" },
      { id: "headers", title: "Headers" },
      { id: "sending", title: "Sending limits" },
    ],
    Content: () => (
      <>
        <H2 id="limits">Default limits</H2>
        <table>
          <thead>
            <tr>
              <th scope="col">Scope</th>
              <th scope="col">Limit</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>All endpoints, per API key</td>
              <td>600 requests per minute</td>
            </tr>
            <tr>
              <td>POST /sms/send and /sms/bulk, per API key</td>
              <td>120 requests per minute</td>
            </tr>
            <tr>
              <td>Failed authentication, per IP</td>
              <td>30 per 5 minutes</td>
            </tr>
          </tbody>
        </table>
        <H2 id="headers">Headers</H2>
        <ul>
          <li><code>X-RateLimit-Limit</code>: requests allowed in the current window.</li>
          <li><code>X-RateLimit-Remaining</code>: requests left.</li>
          <li><code>X-RateLimit-Reset</code>: Unix time when the window resets.</li>
          <li><code>Retry-After</code>: seconds to wait (on 429 only).</li>
        </ul>
        <H2 id="sending">Sending limits</H2>
        <p>
          Independently of request rates, each account has daily and monthly message limits (Asia/Dhaka calendar). Exceeding them returns <code>DAILY_LIMIT_EXCEEDED</code> or <code>MONTHLY_LIMIT_EXCEEDED</code>. Limits protect you from runaway loops and are raised by support as your account builds a sending history.
        </p>
      </>
    ),
  },
  {
    slug: "api-reference",
    title: "API reference",
    description: "Every public endpoint in one place.",
    group: "Reference",
    toc: [
      { id: "endpoints", title: "Endpoints" },
      { id: "send-sms", title: "Send SMS" },
      { id: "bulk-sms", title: "Bulk SMS" },
      { id: "estimate", title: "Estimate" },
      { id: "get-message", title: "Get message" },
      { id: "list-messages", title: "List messages" },
      { id: "balance", title: "Balance" },
      { id: "sender-ids", title: "Sender IDs" },
      { id: "other", title: "Other surfaces" },
    ],
    Content: () => (
      <>
        <H2 id="endpoints">Endpoints</H2>
        <table>
          <thead>
            <tr>
              <th scope="col">Endpoint</th>
              <th scope="col">Scope</th>
              <th scope="col">Description</th>
            </tr>
          </thead>
          <tbody>
            {publicEndpoints.map((e) => (
              <tr key={e.path + e.method}>
                <td>
                  <a href={`#${e.anchor}`}>
                    <code>
                      {e.method} {e.path}
                    </code>
                  </a>
                </td>
                <td>
                  <code>{e.scope}</code>
                </td>
                <td>{e.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <H2 id="send-sms">Send SMS</H2>
        <Endpoint method="POST" path="/api/v1/sms/send" scope="sms:send" />
        <p>
          Body: <code>to</code>, <code>message</code>, optional <code>sender_id</code>, <code>type</code>, <code>reference</code>, <code>schedule_at</code>. Returns <code>202</code>. See <Link href="/docs/send-sms">Send SMS</Link>.
        </p>
        <H2 id="bulk-sms">Bulk SMS</H2>
        <Endpoint method="POST" path="/api/v1/sms/bulk" scope="sms:send" />
        <p>
          Body: <code>recipients[]</code>, <code>message</code>, optional fields as above. Returns <code>202</code> with accepted messages and per-recipient errors. See <Link href="/docs/bulk-sms">Bulk SMS</Link>.
        </p>
        <H2 id="estimate">Estimate</H2>
        <Endpoint method="POST" path="/api/v1/sms/estimate" scope="sms:send" />
        <p>
          Body: <code>message</code>, optional <code>recipients</code> (count, default 1), <code>type</code>, <code>sender_id</code>. Returns encoding, segments, rate and estimated cost. Nothing is sent.
        </p>
        <H2 id="get-message">Get message</H2>
        <Endpoint method="GET" path="/api/v1/messages/{id}" scope="messages:read" />
        <p>Returns the message with timestamps, cost, error details and event history. Messages of other accounts return 404.</p>
        <H2 id="list-messages">List messages</H2>
        <Endpoint method="GET" path="/api/v1/messages" scope="messages:read" />
        <p>Cursor-paginated, newest first. Filters: status, to, reference, from, until, limit, cursor.</p>
        <H2 id="balance">Balance</H2>
        <Endpoint method="GET" path="/api/v1/balance" scope="balance:read" />
        <CodeWrap>
          <ApiCodeBlock samples={balanceSamples} />
        </CodeWrap>
        <H2 id="sender-ids">Sender IDs</H2>
        <Endpoint method="GET" path="/api/v1/sender-ids" scope="sender_ids:read" />
        <p>Lists sender IDs with type, status and default flag.</p>
        <H2 id="other">Other API surfaces</H2>
        <p>These are not part of the public customer API but are documented for operators:</p>
        <ul>
          <li><code>/api/v1/auth/*</code>: register, login, logout, email verification and password reset (session cookies; used by first-party apps).</li>
          <li><code>/api/v1/app/*</code>: dashboard exports (CSV, invoices), session-authenticated.</li>
          <li><code>/api/v1/admin/*</code>: platform administration, restricted to platform staff.</li>
          <li><code>/api/v1/webhooks/sms/&#123;provider&#125;</code> and <code>/api/v1/webhooks/payments/&#123;provider&#125;</code>: inbound provider callbacks, verified by signature.</li>
        </ul>
      </>
    ),
  },
  {
    slug: "changelog",
    title: "Changelog",
    description: "Changes to the SMSFlow BD API.",
    group: "Reference",
    toc: [{ id: "v1", title: "v1.0.0" }],
    Content: () => (
      <>
        <H2 id="v1">v1.0.0 (initial release)</H2>
        <ul>
          <li>Send SMS, bulk SMS and cost estimate endpoints.</li>
          <li>Message status and list endpoints with event history.</li>
          <li>Balance and sender ID endpoints.</li>
          <li>Idempotency keys for send endpoints.</li>
          <li>Signed webhooks: message.delivered, message.failed, campaign.completed.</li>
        </ul>
        <p>Breaking changes will only be introduced in a new version path (/api/v2). Additive changes (new fields, new endpoints, new error codes) can happen within v1; build clients that ignore unknown fields.</p>
      </>
    ),
  },
];

export const docGroups = ["Getting started", "Sending", "Tracking", "Reference"] as const;

export function findDoc(slug: string) {
  return docPages.find((d) => d.slug === slug);
}
