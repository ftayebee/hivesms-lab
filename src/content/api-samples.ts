import type { CodeSample } from "@/components/docs/code-block";
import { siteConfig } from "@/config/site";

const BASE = siteConfig.apiBaseUrl;

export const sendSmsSamples: CodeSample[] = [
  {
    label: "cURL",
    language: "bash",
    code: `curl -X POST ${BASE}/sms/send \\
  -H "Authorization: Bearer $SMSFLOW_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: order-10234-otp" \\
  -d '{
    "to": "+8801XXXXXXXXX",
    "message": "Your verification code is 123456",
    "sender_id": "YOURBRAND",
    "type": "transactional"
  }'`,
  },
  {
    label: "JavaScript",
    language: "javascript",
    code: `// Node.js 18+ (built-in fetch). Keep the API key on your server, never in browser code.
const res = await fetch("${BASE}/sms/send", {
  method: "POST",
  headers: {
    "Authorization": \`Bearer \${process.env.SMSFLOW_API_KEY}\`,
    "Content-Type": "application/json",
    "Idempotency-Key": "order-10234-otp",
  },
  body: JSON.stringify({
    to: "+8801XXXXXXXXX",
    message: "Your verification code is 123456",
    sender_id: "YOURBRAND",
    type: "transactional",
  }),
});
const body = await res.json();
if (!body.success) throw new Error(\`\${body.error.code}: \${body.error.message}\`);
console.log(body.data.message_id, body.data.status);`,
  },
  {
    label: "PHP",
    language: "php",
    code: `<?php
$payload = json_encode([
    "to" => "+8801XXXXXXXXX",
    "message" => "Your verification code is 123456",
    "sender_id" => "YOURBRAND",
    "type" => "transactional",
]);

$ch = curl_init("${BASE}/sms/send");
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        "Authorization: Bearer " . getenv("SMSFLOW_API_KEY"),
        "Content-Type: application/json",
        "Idempotency-Key: order-10234-otp",
    ],
    CURLOPT_POSTFIELDS => $payload,
]);
$body = json_decode(curl_exec($ch), true);
curl_close($ch);

if (!$body["success"]) {
    throw new Exception($body["error"]["code"] . ": " . $body["error"]["message"]);
}
echo $body["data"]["message_id"];`,
  },
  {
    label: "Python",
    language: "python",
    code: `import os
import requests

res = requests.post(
    "${BASE}/sms/send",
    headers={
        "Authorization": f"Bearer {os.environ['SMSFLOW_API_KEY']}",
        "Idempotency-Key": "order-10234-otp",
    },
    json={
        "to": "+8801XXXXXXXXX",
        "message": "Your verification code is 123456",
        "sender_id": "YOURBRAND",
        "type": "transactional",
    },
    timeout=15,
)
body = res.json()
if not body["success"]:
    raise RuntimeError(f"{body['error']['code']}: {body['error']['message']}")
print(body["data"]["message_id"], body["data"]["status"])`,
  },
];

export const sendSmsRequestJson: CodeSample = {
  label: "Request body",
  language: "json",
  code: `{
  "to": "+8801XXXXXXXXX",
  "message": "Your verification code is 123456",
  "sender_id": "YOURBRAND",
  "type": "transactional"
}`,
};

export const sendSmsResponseJson: CodeSample = {
  label: "Response 202",
  language: "json",
  code: `{
  "success": true,
  "data": {
    "message_id": "5b0f2c7e-7a55-4b1e-9d0a-3c1d2e4f6a70",
    "to": "+8801XXXXXXXXX",
    "status": "queued",
    "segments": 1,
    "encoding": "GSM7",
    "cost": "0.35",
    "currency": "BDT"
  },
  "meta": { "requestId": "req_8f2k1m0q7x3v9b2n" }
}`,
};

export const errorResponseJson: CodeSample = {
  label: "Error response",
  language: "json",
  code: `{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "Insufficient balance. Add balance to your wallet and try again.",
    "details": { "required": "35.00" }
  },
  "meta": { "requestId": "req_1c9x0b2m4n6v8q7w" }
}`,
};

export const bulkSmsSamples: CodeSample[] = [
  {
    label: "cURL",
    language: "bash",
    code: `curl -X POST ${BASE}/sms/bulk \\
  -H "Authorization: Bearer $SMSFLOW_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "sender_id": "YOURBRAND",
    "type": "transactional",
    "message": "Hi {{name}}, your order {{order}} has shipped.",
    "recipients": [
      { "to": "+8801XXXXXXXXX", "variables": { "name": "Rahim", "order": "#1001" } },
      { "to": "01XXXXXXXXX", "variables": { "name": "Karima", "order": "#1002" } }
    ]
  }'`,
  },
  {
    label: "Response",
    language: "json",
    code: `{
  "success": true,
  "data": {
    "batch_id": "0c5e...",
    "accepted": 2,
    "rejected": 0,
    "total_cost": "0.70",
    "messages": [
      { "message_id": "8a1f...", "to": "+8801XXXXXXXXX", "status": "queued", "segments": 1 },
      { "message_id": "c93b...", "to": "+8801XXXXXXXXX", "status": "queued", "segments": 1 }
    ],
    "errors": []
  },
  "meta": { "requestId": "req_..." }
}`,
  },
];

export const statusSamples: CodeSample[] = [
  {
    label: "cURL",
    language: "bash",
    code: `curl ${BASE}/messages/5b0f2c7e-7a55-4b1e-9d0a-3c1d2e4f6a70 \\
  -H "Authorization: Bearer $SMSFLOW_API_KEY"`,
  },
  {
    label: "Response",
    language: "json",
    code: `{
  "success": true,
  "data": {
    "message_id": "5b0f2c7e-7a55-4b1e-9d0a-3c1d2e4f6a70",
    "to": "+8801XXXXXXXXX",
    "status": "delivered",
    "sender_id": "YOURBRAND",
    "segments": 1,
    "cost": "0.35",
    "error_code": null,
    "error_message": null,
    "queued_at": "2026-09-30T08:15:02.114Z",
    "submitted_at": "2026-09-30T08:15:03.020Z",
    "delivered_at": "2026-09-30T08:15:09.771Z",
    "events": [
      { "status": "submitted", "at": "2026-09-30T08:15:03.020Z" },
      { "status": "delivered", "at": "2026-09-30T08:15:09.771Z" }
    ]
  },
  "meta": { "requestId": "req_..." }
}`,
  },
];

export const balanceSamples: CodeSample[] = [
  {
    label: "cURL",
    language: "bash",
    code: `curl ${BASE}/balance -H "Authorization: Bearer $SMSFLOW_API_KEY"`,
  },
  {
    label: "Response",
    language: "json",
    code: `{
  "success": true,
  "data": {
    "balance": "1523.4500",
    "currency": "BDT",
    "rates": {
      "transactional": { "masking": "0.55", "non_masking": "0.35" },
      "promotional": { "masking": "0.55", "non_masking": "0.35" }
    }
  },
  "meta": { "requestId": "req_..." }
}`,
  },
];

export const webhookVerifySamples: CodeSample[] = [
  {
    label: "JavaScript",
    language: "javascript",
    code: `import crypto from "node:crypto";

// Express: use the raw body, not the parsed JSON, when computing the signature.
app.post("/webhooks/sms", express.raw({ type: "application/json" }), (req, res) => {
  const header = req.get("X-SMSFlow-Signature") ?? ""; // "t=1727683200,v1=5d41..."
  const { t, v1 } = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  const expected = crypto
    .createHmac("sha256", process.env.SMSFLOW_WEBHOOK_SECRET)
    .update(\`\${t}.\${req.body}\`)
    .digest("hex");
  const fresh = Math.abs(Date.now() / 1000 - Number(t)) < 300;
  if (!fresh || !crypto.timingSafeEqual(Buffer.from(v1 ?? ""), Buffer.from(expected))) {
    return res.status(400).send("invalid signature");
  }
  const event = JSON.parse(req.body);
  // Deduplicate on event.id: the same delivery can be retried.
  res.sendStatus(200);
});`,
  },
  {
    label: "PHP",
    language: "php",
    code: `<?php
$raw = file_get_contents("php://input");
parse_str(str_replace(",", "&", $_SERVER["HTTP_X_SMSFLOW_SIGNATURE"] ?? ""), $sig);
$expected = hash_hmac("sha256", $sig["t"] . "." . $raw, getenv("SMSFLOW_WEBHOOK_SECRET"));

if (abs(time() - (int) $sig["t"]) > 300 || !hash_equals($expected, $sig["v1"] ?? "")) {
    http_response_code(400);
    exit("invalid signature");
}
$event = json_decode($raw, true);
http_response_code(200);`,
  },
  {
    label: "Python",
    language: "python",
    code: `import hashlib, hmac, os, time

def verify(raw_body: bytes, header: str) -> bool:
    parts = dict(p.split("=", 1) for p in header.split(","))
    expected = hmac.new(
        os.environ["SMSFLOW_WEBHOOK_SECRET"].encode(),
        f"{parts['t']}.".encode() + raw_body,
        hashlib.sha256,
    ).hexdigest()
    fresh = abs(time.time() - int(parts["t"])) < 300
    return fresh and hmac.compare_digest(expected, parts.get("v1", ""))`,
  },
];

export const webhookPayloadJson: CodeSample = {
  label: "Webhook payload",
  language: "json",
  code: `{
  "id": "d2c1b9e0-...",
  "event": "message.delivered",
  "created_at": "2026-09-30T08:15:10.002Z",
  "data": {
    "message_id": "5b0f2c7e-7a55-4b1e-9d0a-3c1d2e4f6a70",
    "to": "+8801XXXXXXXXX",
    "status": "delivered",
    "error_code": null,
    "segments": 1,
    "cost": "0.35",
    "refunded": false,
    "client_reference": "order-10234",
    "campaign_id": null,
    "occurred_at": "2026-09-30T08:15:09.771Z"
  }
}`,
};
