/**
 * SMS character counting and segmentation.
 *
 * This module is pure (no server imports) so the exact same calculation runs in the composer
 * (live preview) and on the server (billing). Limits are passed in as rules because providers
 * differ: the defaults follow GSM 03.38 (160/153 for GSM-7, 70/67 for UCS-2), but some
 * gateways count differently. Configure per provider in Admin → Settings → SMS policy.
 *
 * - GSM-7: the basic character set counts 1 unit; characters from the extension table
 *   (e.g. { } [ ] ~ \ | ^ €) count 2 units (escape + char) and are never split across parts.
 * - UCS-2: any character outside GSM-7 (e.g. Bangla, emoji) switches the whole message to
 *   UCS-2. Counting is in UTF-16 code units; a surrogate pair (emoji) counts 2 and is never
 *   split across parts.
 */

export interface SegmentationRules {
  gsm7: { single: number; multipart: number };
  ucs2: { single: number; multipart: number };
  maxSegments: number;
}

export const STANDARD_RULES: SegmentationRules = {
  gsm7: { single: 160, multipart: 153 },
  ucs2: { single: 70, multipart: 67 },
  maxSegments: 10,
};

export type Encoding = "GSM7" | "UCS2";

// GSM 03.38 basic character set (including LF and CR).
const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXTENDED = "^{}\\[~]|€\f";

const basicSet = new Set(Array.from(GSM7_BASIC));
const extendedSet = new Set(Array.from(GSM7_EXTENDED));

export interface SegmentInfo {
  encoding: Encoding;
  /** Characters as the user perceives them (code points). */
  characters: number;
  /** Units consumed in the chosen encoding (septets for GSM-7, UTF-16 units for UCS-2). */
  units: number;
  segments: number;
  /** Units allowed per segment at the current segment count. */
  perSegment: number;
  /** Units remaining before another segment is needed. */
  remainingInSegment: number;
  /** Characters that forced UCS-2 (first few, for UI hints). */
  nonGsmCharacters: string[];
  exceedsMax: boolean;
}

export function detectEncoding(text: string): { encoding: Encoding; nonGsm: string[] } {
  const nonGsm: string[] = [];
  for (const ch of text) {
    if (!basicSet.has(ch) && !extendedSet.has(ch)) {
      if (nonGsm.length < 5 && !nonGsm.includes(ch)) nonGsm.push(ch);
      if (nonGsm.length >= 5) break;
    }
  }
  return { encoding: nonGsm.length ? "UCS2" : "GSM7", nonGsm };
}

/** Units per character in the given encoding. */
function charUnits(ch: string, encoding: Encoding): number {
  if (encoding === "GSM7") return extendedSet.has(ch) ? 2 : 1;
  return ch.length; // UTF-16 code units (2 for astral-plane characters such as emoji)
}

/**
 * Splits text into parts respecting unit limits without breaking an escape sequence or a
 * surrogate pair. Returns part sizes in units.
 */
function splitUnits(chars: string[], encoding: Encoding, perPart: number): number {
  let parts = 1;
  let used = 0;
  for (const ch of chars) {
    const u = charUnits(ch, encoding);
    if (used + u > perPart) {
      parts++;
      used = u;
    } else {
      used += u;
    }
  }
  return parts;
}

export function calculateSegments(text: string, rules: SegmentationRules = STANDARD_RULES): SegmentInfo {
  const { encoding, nonGsm } = detectEncoding(text);
  const chars = Array.from(text);
  const limits = encoding === "GSM7" ? rules.gsm7 : rules.ucs2;
  const units = chars.reduce((sum, ch) => sum + charUnits(ch, encoding), 0);

  let segments: number;
  let perSegment: number;
  if (units === 0) {
    segments = 0;
    perSegment = limits.single;
  } else if (units <= limits.single) {
    segments = 1;
    perSegment = limits.single;
  } else {
    segments = splitUnits(chars, encoding, limits.multipart);
    perSegment = limits.multipart;
  }

  const capacity = segments <= 1 ? limits.single : segments * limits.multipart;
  return {
    encoding,
    characters: chars.length,
    units,
    segments,
    perSegment,
    remainingInSegment: Math.max(0, capacity - units),
    nonGsmCharacters: nonGsm,
    exceedsMax: segments > rules.maxSegments,
  };
}

/** Renders {{variable}} placeholders. Unknown variables become empty strings. */
export function renderTemplate(body: string, vars: Record<string, string | null | undefined>): string {
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => vars[key] ?? "");
}

export function extractTemplateVariables(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) out.add(m[1]);
  return [...out];
}
