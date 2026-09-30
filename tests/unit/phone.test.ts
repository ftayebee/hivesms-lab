import { describe, expect, it } from "vitest";
import { detectOperator, formatBdPhone, isValidBdPhone, normalizeBdPhone, parseRecipientList } from "@/lib/phone";

describe("Bangladesh phone numbers", () => {
  it.each([
    ["01712345678", "+8801712345678"],
    ["8801712345678", "+8801712345678"],
    ["+8801712345678", "+8801712345678"],
    ["+880 1712-345678", "+8801712345678"],
    ["008801812345678", "+8801812345678"],
    ["(017) 1234-5678", "+8801712345678"],
    ["1912345678", "+8801912345678"],
    [" 01312345678 ", "+8801312345678"],
  ])("normalises %s", (input, expected) => {
    expect(normalizeBdPhone(input)).toBe(expected);
  });

  it.each(["", "12345", "0171234567", "017123456789", "01212345678", "01112345678", "+14155550123", "abc01712345678", "+8802712345678", null, undefined])("rejects %s", (input) => {
    expect(normalizeBdPhone(input as string)).toBeNull();
    expect(isValidBdPhone(input as string)).toBe(false);
  });

  it("detects operators by prefix", () => {
    expect(detectOperator("+8801712345678")).toBe("Grameenphone");
    expect(detectOperator("+8801312345678")).toBe("Grameenphone");
    expect(detectOperator("+8801912345678")).toBe("Banglalink");
    expect(detectOperator("+8801512345678")).toBe("Teletalk");
    expect(detectOperator("+8801612345678")).toBe("Airtel");
    expect(detectOperator("+8801812345678")).toBe("Robi");
  });

  it("formats for display", () => {
    expect(formatBdPhone("+8801712345678")).toBe("+880 1712-345678");
  });

  it("parses pasted lists: separators, duplicates and invalid entries", () => {
    const r = parseRecipientList("01712345678, 8801712345678\n01812345678;bad  01912345678\n\n12345");
    expect(r.valid).toEqual(["+8801712345678", "+8801812345678", "+8801912345678"]);
    expect(r.invalid).toEqual(["bad", "12345"]);
    expect(r.duplicates).toBe(1);
  });

  it("respects the parse limit", () => {
    const many = Array.from({ length: 50 }, (_, i) => `017${String(10000000 + i)}`).join("\n");
    expect(parseRecipientList(many, 10).valid).toHaveLength(10);
  });
});
