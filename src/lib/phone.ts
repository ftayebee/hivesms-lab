/**
 * Bangladesh mobile number handling.
 *
 * Valid BD mobile numbers: 01[3-9]XXXXXXXX (11 digits nationally), +880 1[3-9]XXXXXXXX in E.164.
 * Accepted input forms: "01712345678", "8801712345678", "+8801712345678", "+880 1712-345678",
 * "008801712345678". Everything is normalised to E.164 (+8801XXXXXXXXX).
 *
 * Operator detection is by prefix only. Bangladesh has mobile number portability, so a
 * number may have moved to a different operator: treat the result as a hint for reporting,
 * never for routing or billing decisions.
 */

const BD_MOBILE_E164 = /^\+8801[3-9]\d{8}$/;

export type BdOperator = "Grameenphone" | "Robi" | "Airtel" | "Banglalink" | "Teletalk" | "Unknown";

const PREFIX_OPERATOR: Record<string, BdOperator> = {
  "013": "Grameenphone",
  "017": "Grameenphone",
  "014": "Banglalink",
  "019": "Banglalink",
  "015": "Teletalk",
  "016": "Airtel",
  "018": "Robi",
};

/** Returns the E.164 form, or null when the input is not a valid BD mobile number. */
export function normalizeBdPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let digits = String(input).trim().replace(/[\s\-().]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (!/^\d+$/.test(digits)) return null;
  if (digits.startsWith("00880")) digits = digits.slice(2);

  let national: string;
  if (digits.startsWith("880")) national = `0${digits.slice(3)}`;
  else if (digits.startsWith("01")) national = digits;
  else if (digits.startsWith("1") && digits.length === 10) national = `0${digits}`;
  else return null;

  if (national.length !== 11) return null;
  const e164 = `+88${national}`;
  return BD_MOBILE_E164.test(e164) ? e164 : null;
}

export function isValidBdPhone(input: string | null | undefined): boolean {
  return normalizeBdPhone(input) !== null;
}

export function detectOperator(e164: string): BdOperator {
  const national = e164.startsWith("+880") ? `0${e164.slice(4)}` : e164;
  return PREFIX_OPERATOR[national.slice(0, 3)] ?? "Unknown";
}

/** Human-friendly display: +880 1712-345678 */
export function formatBdPhone(e164: string): string {
  if (!BD_MOBILE_E164.test(e164)) return e164;
  const n = e164.slice(4); // 1712345678
  return `+880 ${n.slice(0, 4)}-${n.slice(4)}`;
}

export interface ParsedRecipients {
  valid: string[];
  invalid: string[];
  duplicates: number;
}

/**
 * Parses a free-form list of numbers (comma, semicolon, whitespace or newline separated),
 * normalises them, removes duplicates and reports invalid entries.
 */
export function parseRecipientList(raw: string, limit = 100_000): ParsedRecipients {
  const tokens = raw
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, limit);
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  let duplicates = 0;
  for (const token of tokens) {
    const n = normalizeBdPhone(token);
    if (!n) {
      invalid.push(token);
      continue;
    }
    if (seen.has(n)) {
      duplicates++;
      continue;
    }
    seen.add(n);
    valid.push(n);
  }
  return { valid, invalid, duplicates };
}
