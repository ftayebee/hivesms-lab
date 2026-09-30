/**
 * Abuse-risk heuristics hook. Deliberately simple and conservative: it flags content for human
 * review rather than silently blocking. Replace or extend `evaluateMessageRisk` with a scoring
 * service later; callers only depend on the returned decision.
 */
export interface RiskInput {
  message: string;
  smsType: "TRANSACTIONAL" | "PROMOTIONAL";
  recipientCount: number;
  organizationAgeDays: number;
}

export interface RiskDecision {
  action: "allow" | "review";
  reasons: string[];
}

const URL_SHORTENERS = ["bit.ly", "tinyurl.com", "t.co", "goo.gl", "is.gd", "cutt.ly", "rb.gy", "shorturl.at", "tiny.cc"];
const CREDENTIAL_PHISHING = /(verify|confirm|update|unlock).{0,40}(account|pin|password|otp|card)/i;
const URL = /(https?:\/\/|www\.)[^\s]+/i;

export function evaluateMessageRisk(input: RiskInput): RiskDecision {
  const reasons: string[] = [];
  const lower = input.message.toLowerCase();
  if (URL_SHORTENERS.some((d) => lower.includes(d))) reasons.push("Contains a URL shortener");
  if (URL.test(input.message) && CREDENTIAL_PHISHING.test(input.message)) {
    reasons.push("Asks the recipient to verify account details and contains a link");
  }
  if (input.organizationAgeDays < 3 && input.recipientCount > 500) {
    reasons.push("Large send from a new account");
  }
  if (input.smsType === "TRANSACTIONAL" && input.recipientCount > 2000) {
    reasons.push("Very large transactional batch (transactional traffic is usually one-to-one)");
  }
  return { action: reasons.length ? "review" : "allow", reasons };
}
