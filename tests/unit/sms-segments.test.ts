import { describe, expect, it } from "vitest";
import { calculateSegments, detectEncoding, extractTemplateVariables, renderTemplate, STANDARD_RULES } from "@/lib/sms-segments";

describe("SMS segmentation", () => {
  it("returns zero segments for an empty message", () => {
    expect(calculateSegments("").segments).toBe(0);
  });

  it("fits 160 GSM-7 characters in one segment and splits at 161", () => {
    expect(calculateSegments("a".repeat(160))).toMatchObject({ encoding: "GSM7", segments: 1, units: 160 });
    expect(calculateSegments("a".repeat(161))).toMatchObject({ segments: 2, perSegment: 153 });
    expect(calculateSegments("a".repeat(306)).segments).toBe(2);
    expect(calculateSegments("a".repeat(307)).segments).toBe(3);
  });

  it("counts GSM-7 extension characters as two units", () => {
    const info = calculateSegments("Price: 100€ {promo}");
    expect(info.encoding).toBe("GSM7");
    expect(info.characters).toBe(19);
    expect(info.units).toBe(22); // €, { and } take two septets each
  });

  it("never splits an escape sequence across segments", () => {
    // 152 plain chars + "€" (2 units) = 154 units > 153: the euro sign must move to part 2.
    const text = "a".repeat(152) + "€" + "b".repeat(100);
    const info = calculateSegments(text);
    expect(info.segments).toBe(2);
    expect(calculateSegments("a".repeat(159) + "€").segments).toBe(2); // 161 units
  });

  it("switches the whole message to UCS-2 for Bangla", () => {
    const bn = "আপনার অর্ডার";
    expect(detectEncoding(bn).encoding).toBe("UCS2");
    const one = calculateSegments("ক".repeat(70));
    expect(one).toMatchObject({ encoding: "UCS2", segments: 1 });
    expect(calculateSegments("ক".repeat(71))).toMatchObject({ segments: 2, perSegment: 67 });
    expect(calculateSegments("ক".repeat(134)).segments).toBe(2);
    expect(calculateSegments("ক".repeat(135)).segments).toBe(3);
  });

  it("switches to UCS-2 for a single emoji in otherwise plain text and counts surrogate pairs as two units", () => {
    const info = calculateSegments("Thanks 🙂");
    expect(info.encoding).toBe("UCS2");
    expect(info.characters).toBe(8);
    expect(info.units).toBe(9);
  });

  it("does not split a surrogate pair across segments", () => {
    const text = "x".repeat(66) + "🙂" + "y".repeat(10); // 66 + 2 = 68 > 67 per part
    expect(calculateSegments(text).segments).toBe(2);
  });

  it("flags messages above the configured maximum", () => {
    const rules = { ...STANDARD_RULES, maxSegments: 2 };
    expect(calculateSegments("a".repeat(307), rules).exceedsMax).toBe(true);
    expect(calculateSegments("a".repeat(306), rules).exceedsMax).toBe(false);
  });

  it("honours provider-specific limits", () => {
    const rules = { gsm7: { single: 140, multipart: 134 }, ucs2: { single: 70, multipart: 67 }, maxSegments: 10 };
    expect(calculateSegments("a".repeat(150), rules).segments).toBe(2);
  });

  it("treats newlines as GSM-7 characters", () => {
    expect(calculateSegments("Line 1\nLine 2")).toMatchObject({ encoding: "GSM7", units: 13 });
  });
});

describe("templates", () => {
  it("renders variables and blanks unknown ones", () => {
    expect(renderTemplate("Hi {{name}}, order {{ order }} {{missing}}!", { name: "Rahim", order: "#12" })).toBe("Hi Rahim, order #12 !");
  });
  it("extracts unique variable names", () => {
    expect(extractTemplateVariables("{{a}} {{b}} {{a}}")).toEqual(["a", "b"]);
  });
});
