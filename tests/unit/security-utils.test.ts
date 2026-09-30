import { beforeAll, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, hmacSha256, randomToken, safeEqual } from "@/lib/crypto";
import { parseCsv, sanitizeCsvCell, toCsv, unescapeCsvCell } from "@/lib/csv";
import { assertAcceptableUrl, isPrivateAddress } from "@/lib/safe-url";
import { evaluateMessageRisk } from "@/services/risk";
import { API_KEY_PREFIX, generateApiKey, hashApiKey } from "@/lib/api/api-keys";

beforeAll(() => {
  process.env.SETTINGS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
  process.env.API_KEY_PEPPER ??= "unit-test-pepper-unit-test-pepper-0001";
});

describe("crypto helpers", () => {
  it("round-trips encrypted secrets and detects tampering", () => {
    const ct = encryptSecret("provider-secret-value");
    expect(ct.startsWith("v1.")).toBe(true);
    expect(ct).not.toContain("provider-secret-value");
    expect(decryptSecret(ct)).toBe("provider-secret-value");
    const parts = ct.split(".");
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith("A") ? "BB" : "AA");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });

  it("uses different IVs for the same plaintext", () => {
    expect(encryptSecret("x")).not.toBe(encryptSecret("x"));
  });

  it("compares in constant time", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });

  it("produces url-safe random tokens", () => {
    expect(randomToken(32)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("computes HMAC-SHA256", () => {
    expect(hmacSha256("key", "The quick brown fox jumps over the lazy dog")).toBe("f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
  });
});

describe("API keys", () => {
  it("generates keys with a visible prefix and a hash that never contains the key", () => {
    const k = generateApiKey();
    expect(k.fullKey.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(k.fullKey.startsWith(`${k.prefix}_`)).toBe(true);
    expect(k.keyHash).toHaveLength(64);
    expect(k.keyHash).not.toContain(k.fullKey.slice(-10));
    expect(hashApiKey(k.fullKey)).toBe(k.keyHash);
  });
});

describe("CSV", () => {
  it("neutralises formula injection", () => {
    expect(sanitizeCsvCell("=HYPERLINK(\"http://x\")")).toBe("'=HYPERLINK(\"http://x\")");
    expect(sanitizeCsvCell("+8801712345678")).toBe("'+8801712345678");
    expect(sanitizeCsvCell("-2")).toBe("'-2");
    expect(sanitizeCsvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(sanitizeCsvCell("Normal")).toBe("Normal");
    expect(sanitizeCsvCell(null)).toBe("");
  });

  it("writes a UTF-8 BOM and quotes every cell", () => {
    const csv = toCsv(["a", "b"], [["x,y", "প্রিয়"]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"x,y"');
  });

  it("parses headers case-insensitively and strips the BOM", () => {
    const r = parseCsv("﻿Phone, Full Name\n01712345678,Rahim\n");
    expect(r.headers).toEqual(["phone", "full_name"]);
    expect(r.rows[0]).toEqual({ phone: "01712345678", full_name: "Rahim" });
  });

  it("round-trips escaped cells", () => {
    expect(unescapeCsvCell("'+8801712345678")).toBe("+8801712345678");
    expect(unescapeCsvCell("'hello")).toBe("'hello");
  });
});

describe("SSRF guard", () => {
  it.each(["10.0.0.5", "127.0.0.1", "192.168.1.1", "172.16.4.2", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "::ffff:10.0.0.1"])("treats %s as private", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });
  it.each(["8.8.8.8", "203.0.113.10", "2606:4700::1111"])("treats %s as public", (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
  it("rejects plain HTTP, credentials and private literal IPs", () => {
    expect(() => assertAcceptableUrl("http://example.com/hook")).toThrow(/HTTPS/);
    expect(() => assertAcceptableUrl("https://user:pw@example.com/hook")).toThrow(/credentials/);
    expect(() => assertAcceptableUrl("https://10.1.2.3/hook")).toThrow(/Private/);
    expect(() => assertAcceptableUrl("not a url")).toThrow(/valid URL/);
    expect(assertAcceptableUrl("https://api.example.com/hook").hostname).toBe("api.example.com");
  });
});

describe("risk heuristics", () => {
  it("flags URL shorteners and credential phishing patterns", () => {
    expect(evaluateMessageRisk({ message: "Win now bit.ly/x", smsType: "PROMOTIONAL", recipientCount: 10, organizationAgeDays: 100 }).action).toBe("review");
    expect(
      evaluateMessageRisk({ message: "Verify your account PIN at https://bank.example.com", smsType: "TRANSACTIONAL", recipientCount: 1, organizationAgeDays: 100 }).reasons,
    ).toHaveLength(1);
  });
  it("allows ordinary messages", () => {
    expect(evaluateMessageRisk({ message: "Your order has shipped.", smsType: "TRANSACTIONAL", recipientCount: 1, organizationAgeDays: 1 }).action).toBe("allow");
  });
  it("flags large sends from brand-new accounts", () => {
    expect(evaluateMessageRisk({ message: "Hello", smsType: "PROMOTIONAL", recipientCount: 1000, organizationAgeDays: 1 }).action).toBe("review");
  });
});
