import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

/**
 * The core customer journey, end to end:
 * register -> verify email -> buy credits (mock gateway) -> send a campaign ->
 * see delivery in reports -> create an API key.
 */

const run = Date.now().toString(36);
const email = `e2e-${run}@example.com`;
// 017 + 8 digits, unique per run. Avoid the mock provider's magic suffixes (0000, 8888, 9999).
const phone = `017${String(Date.now()).slice(-8, -1)}1`;
const password = "E2e-Journey-Pass-2026";
const MAILBOX = path.resolve(".local", "mailbox");

async function findVerifyLink(to: string): Promise<string> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const files = (await readdir(MAILBOX).catch(() => [] as string[])).filter((f) => f.endsWith("_verify-email.html")).sort().reverse();
    for (const f of files) {
      const html = await readFile(path.join(MAILBOX, f), "utf8");
      if (!html.startsWith(`<!-- To: ${to} `)) continue;
      const m = html.match(/href="([^"]*\/verify-email\?token=[^"]+)"/);
      if (m) return m[1].replace(/&amp;/g, "&");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No verification email for ${to} in ${MAILBOX}`);
}

test.describe.configure({ mode: "serial" });

test("customer journey: register to delivered campaign and API key", async ({ page }) => {
  await test.step("register", async () => {
    await page.goto("/register");
    await page.locator('input[name="name"]').fill("E2E Tester");
    await page.locator('input[name="company"]').fill(`E2E Shop ${run}`);
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="phone"]').fill(phone);
    await page.locator('input[name="password"]').fill(password);
    await page.locator('input[name="confirmPassword"]').fill(password);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL(/\/dashboard/);
    await expect(page.getByText("Verify your email address").first()).toBeVisible();
  });

  await test.step("verify email from the dev mailbox", async () => {
    const link = new URL(await findVerifyLink(email));
    await page.goto(link.pathname + link.search);
    await page.getByRole("button", { name: "Confirm email address" }).click();
    await page.waitForURL(/\/dashboard/);
    await page.goto("/dashboard/send");
    await expect(page.getByText("Verify your email address to send messages")).toHaveCount(0);
  });

  await test.step("buy credits with the mock gateway", async () => {
    await page.goto("/dashboard/wallet");
    await page.getByText("Custom", { exact: true }).click();
    await page.locator('input[name="amount"]').fill("500");
    await page.locator("label").filter({ hasText: "Test only" }).click();
    await page.getByRole("button", { name: "Continue to payment" }).click();
    await page.waitForURL(/\/dashboard\/wallet\/mock-checkout\//);
    await page.getByRole("button", { name: "Simulate successful payment" }).click();
    await page.waitForURL((u) => !u.pathname.includes("mock-checkout"));
    await page.goto("/dashboard/wallet");
    // BDT 500 before VAT is credited in full.
    await expect(page.getByText(/500\.00/).first()).toBeVisible();
  });

  let campaignUrl = "";
  await test.step("send a campaign to two numbers", async () => {
    await page.goto("/dashboard/send");
    await page.getByPlaceholder("01712345678").fill("01712345671\n01812345672");
    await page.locator("#composer-message").fill(`Hello from the E2E run ${run}`);
    await page.getByRole("button", { name: "Review and send" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Review before sending")).toBeVisible();
    await dialog.getByRole("button", { name: "Send to 2" }).click();
    await page.waitForURL(/\/dashboard\/campaigns\/[0-9a-f-]{36}$/);
    campaignUrl = page.url();
  });

  await test.step("delivery reports arrive", async () => {
    // The mock provider reports delivery a few seconds after submission. Check each
    // recipient's row in the campaign's message table (not the stats labels).
    for (const shown of ["+880 1712-345671", "+880 1812-345672"]) {
      await expect
        .poll(
          async () => {
            await page.reload();
            return (await page.getByRole("row").filter({ hasText: shown }).textContent()) ?? "";
          },
          { timeout: 90_000, intervals: [2000] },
        )
        .toContain("Delivered");
    }

    await page.goto("/dashboard/reports");
    await expect(page.getByText("+880 1712-345671").first()).toBeVisible();
    await page.getByRole("link", { name: "View" }).first().click();
    await expect(page.getByText("Delivery history")).toBeVisible();
    expect(campaignUrl).toContain("/dashboard/campaigns/");
  });

  await test.step("create an API key and see it only once", async () => {
    await page.goto("/dashboard/api");
    // The page header and the empty state both offer the action.
    await page.getByRole("button", { name: "Create API key" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.locator('input[name="name"]').fill("E2E server");
    await dialog.getByRole("button", { name: "Create key" }).click();
    await expect(dialog.getByText("Your new API key: E2E server")).toBeVisible();
    await expect(dialog.getByTestId("secret-value")).toHaveText(/^sfk_live_[A-Za-z0-9]{8}_\S{20,}$/);
    await dialog.getByRole("button", { name: "I have copied the key" }).click();
    await expect(page.getByText("E2E server", { exact: true }).locator("visible=true").first()).toBeVisible();
    // After closing, only the prefix is shown anywhere on the page.
    const html = await page.content();
    expect(html).not.toMatch(/sfk_live_[A-Za-z0-9]{8}_[A-Za-z0-9_-]{20,}/);
  });
});

test("marketing pages render without console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  for (const p of ["/", "/pricing", "/sms-api", "/docs", "/contact"]) {
    const res = await page.goto(p);
    expect(res?.status(), p).toBe(200);
    await expect(page.locator("h1").first()).toBeVisible();
  }
  expect(errors).toEqual([]);
});
