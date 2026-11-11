import { afterEach, describe, expect, it } from "vitest";
import { enabledLaravelFeatures, enabledOptInFeatures, laravelEnabled, LARAVEL_FEATURES } from "@/lib/laravel/flags";
import { templateTokens, unknownTokens } from "@/features/dynamic-sms/types";
import { dashboardNav } from "@/config/dashboard-nav";

describe("opt-in modules (docs/23)", () => {
  const saved = process.env.LARAVEL_FEATURES;
  afterEach(() => {
    process.env.LARAVEL_FEATURES = saved;
  });

  it("are never switched on by `all`", () => {
    process.env.LARAVEL_FEATURES = "all";
    expect(laravelEnabled("dynamicSms")).toBe(false);
    expect(laravelEnabled("manualTopups")).toBe(false);
    expect(laravelEnabled("senderCatalog")).toBe(false);
    expect(enabledOptInFeatures()).toEqual([]);
    expect(enabledLaravelFeatures().size).toBe(LARAVEL_FEATURES.length);
  });

  it("are enabled only when named, and can be excluded again", () => {
    process.env.LARAVEL_FEATURES = "all,dynamicSms,manualTopups";
    expect(enabledOptInFeatures()).toEqual(["dynamicSms", "manualTopups"]);
    process.env.LARAVEL_FEATURES = "all,dynamicSms,-dynamicSms";
    expect(laravelEnabled("dynamicSms")).toBe(false);
  });

  it("gate the Dynamic SMS sidebar item, placed right after Send SMS", () => {
    const items = dashboardNav[0].items;
    const i = items.findIndex((x) => x.key === "send");
    expect(items[i + 1]).toMatchObject({ key: "dynamicSms", href: "/dashboard/dynamic-sms", feature: "dynamicSms", permission: "sms:send" });
  });
});

describe("dynamic SMS placeholders (client hints; Laravel decides)", () => {
  const fields = ["Retail Name", "Due Amount", "Invoice"];

  it("extracts {{Column Name}} tokens including spaces and Bangla", () => {
    expect(templateTokens("Dear {{Retail Name}}, BDT {{ Due Amount }} {{নাম}}")).toEqual(["Retail Name", "Due Amount", "নাম"]);
  });

  it("flags unknown fields case-insensitively, e.g. the excluded phone column", () => {
    expect(unknownTokens("Dear {{retail name}} {{Invoice}}", fields)).toEqual([]);
    expect(unknownTokens("Call {{Mobile Number}} {{Mobile Number}}", fields)).toEqual(["Mobile Number"]);
  });
});
