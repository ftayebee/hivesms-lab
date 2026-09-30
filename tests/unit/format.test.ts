import { describe, expect, it } from "vitest";
import { dateToDhakaLocalInput, dhakaDateKey, dhakaLocalInputToDate, dhakaParts, formatBDT, startOfDhakaDay } from "@/lib/format";
import { parseRange } from "@/features/reports/range";

describe("Asia/Dhaka date handling", () => {
  it("converts datetime-local input (Dhaka) to UTC and back", () => {
    const d = dhakaLocalInputToDate("2026-10-01T10:30")!;
    expect(d.toISOString()).toBe("2026-10-01T04:30:00.000Z");
    expect(dateToDhakaLocalInput(d)).toBe("2026-10-01T10:30");
    expect(dhakaLocalInputToDate("nonsense")).toBeNull();
  });

  it("finds the Dhaka day boundary regardless of server timezone", () => {
    const lateUtc = new Date("2026-09-30T19:00:00Z"); // 01:00 on 1 Oct in Dhaka
    expect(dhakaDateKey(lateUtc)).toBe("2026-10-01");
    expect(startOfDhakaDay(lateUtc).toISOString()).toBe("2026-09-30T18:00:00.000Z");
    expect(dhakaParts(lateUtc).hour).toBe(1);
  });

  it("parses custom report ranges inclusively and rejects oversized ones", () => {
    const r = parseRange({ range: "custom", from: "2026-09-01", to: "2026-09-30" });
    expect(r.key).toBe("custom");
    expect(r.days).toBe(30);
    expect(parseRange({ range: "custom", from: "2020-01-01", to: "2026-09-30" }).key).toBe("30d");
    expect(parseRange({ range: "7d" }).days).toBe(7);
  });
});

describe("currency formatting", () => {
  it("formats BDT in English and Bangla", () => {
    expect(formatBDT(1234.5)).toBe("BDT 1,234.50");
    expect(formatBDT(1234.5, "bn")).toMatch(/^৳/);
  });
});
