import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * The customer journey with every feature switched to the Laravel API (LARAVEL_FEATURES=all):
 * register → verify email → dashboard → contacts (add, search, export) → wallet top-up (mock
 * gateway) → campaign to two numbers → delivery → reports → transactions → API key → logout → login.
 *
 * Run against a LOCAL stack only (mock SMS provider, mock payments; see docs/14 § Testing):
 *   E2E_LARAVEL=1 E2E_BASE_URL=http://localhost:3210 LARAVEL_LOG=backend/storage/logs/laravel.log npx playwright test laravel-cutover
 *
 * The Next.js server for this run has DATABASE_URL pointing at a database that does not exist, so
 * any remaining Prisma call on these paths fails the test. The browser must never call Laravel.
 */
test.skip(!process.env.E2E_LARAVEL, "set E2E_LARAVEL=1 (local Laravel stack) to run");
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const email = `e2e-laravel-${run}@example.com`;
const phone = `018${String(Date.now()).slice(-8, -1)}3`;
const password = "E2e-Laravel-Pass-2026";
const LOG = path.resolve(process.env.LARAVEL_LOG ?? "backend/storage/logs/laravel.log");

/** Laravel's `log` mailer writes the whole message to its log; take the newest verify link sent to `to`. */
async function findVerifyLink(to: string): Promise<string> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const log = await readFile(LOG, "utf8").catch(() => "");
    // One logged message per "To:" header; newest first. Quoted-printable bodies may soft-wrap
    // lines ("=\r\n") and encode "=" as "=3D".
    const messages = log.split(/(?=^To: )/m).filter((m) => m.startsWith(`To: ${to}`)).reverse();
    for (const message of messages) {
      const m = message.replace(/=\r?\n/g, "").replace(/=3D/g, "=").match(/(https?:\/\/[^\s"'<>]*\/verify-email\?token=[A-Za-z0-9_-]+)/);
      if (m) return m[1];
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No verification email for ${to} in ${LOG}`);
}

function watchBrowserRequests(page: Page) {
  const laravelOrigin = new URL(process.env.LARAVEL_API_URL ?? "http://127.0.0.1:8000").origin;
  const leaked: string[] = [];
  page.on("request", (r) => {
    if (r.url().startsWith(laravelOrigin)) leaked.push(r.url());
  });
  return leaked;
}

test("customer journey on the Laravel API", async ({ page }) => {
  const leaked = watchBrowserRequests(page);
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  await test.step("register", async () => {
    await page.goto("/register");
    await page.locator('input[name="name"]').fill("E2E Laravel");
    await page.locator('input[name="company"]').fill(`E2E Laravel Shop ${run}`);
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="phone"]').fill(phone);
    await page.locator('input[name="password"]').fill(password);
    await page.locator('input[name="confirmPassword"]').fill(password);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL(/\/dashboard/);
    await expect(page.getByText("Verify your email address").first()).toBeVisible();
    // The session cookie is httpOnly on this origin; the token is not readable by scripts.
    const cookies = await page.context().cookies();
    const session = cookies.find((c) => /sf_session$/.test(c.name));
    expect(session?.httpOnly).toBe(true);
    expect(session?.sameSite).toBe("Lax");
    expect(await page.evaluate(() => document.cookie)).not.toMatch(/sf_session/);
  });

  await test.step("verify email (link from Laravel's mail log)", async () => {
    const link = new URL(await findVerifyLink(email));
    await page.goto(link.pathname + link.search);
    await page.getByRole("button", { name: "Confirm email address" }).click();
    await page.waitForURL(/\/dashboard/);
    await expect(page.getByText("Verify your email address")).toHaveCount(0);
  });

  await test.step("dashboard", async () => {
    await page.goto("/dashboard?range=7d");
    await expect(page.getByRole("heading", { name: /Welcome back, E2E/ })).toBeVisible();
    await expect(page.getByText("Available balance")).toBeVisible();
    await expect(page.getByText("Total SMS sent")).toBeVisible();
  });

  await test.step("contacts: add, search, export", async () => {
    await page.goto("/dashboard/contacts");
    await page.getByRole("button", { name: /Add contact/ }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.locator('input[name="name"]').fill("Rahim Uddin");
    await dialog.locator('input[name="phone"]').fill("01712345690");
    await dialog.getByRole("button", { name: "Add contact" }).click();
    await expect(page.getByText("Rahim Uddin").first()).toBeVisible();
    await page.goto("/dashboard/contacts?q=Rahim");
    await expect(page.getByText("Rahim Uddin").first()).toBeVisible();
    // A duplicate number shows Laravel's conflict message on the phone field.
    await page.getByRole("button", { name: /Add contact/ }).first().click();
    const again = page.getByRole("dialog");
    await again.locator('input[name="phone"]').fill("01712345690");
    await again.getByRole("button", { name: "Add contact" }).click();
    // Shown inline under the phone field (details.field from Laravel) and in the form summary.
    await expect(again.locator('p[role="alert"]', { hasText: "A contact with this number already exists." })).toBeVisible();
    await page.keyboard.press("Escape");
    const csv = await page.request.get("/api/v1/app/contacts/export");
    expect(csv.status()).toBe(200);
    expect(csv.headers()["content-type"]).toMatch(/text\/csv/);
    expect(await csv.text()).toContain("8801712345690");
  });

  await test.step("contacts: CSV import (multipart to Laravel) with a per-row report", async () => {
    await page.goto("/dashboard/contacts");
    await page.getByRole("button", { name: "Import CSV" }).first().click();
    const imp = page.getByRole("dialog");
    await imp.locator('input[name="file"]').setInputFiles({
      name: "contacts.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(["phone,name,tags", "01712345691,Karim,vip", "01712345692,Salma,", "not-a-number,Bad,", "01712345691,Dup,", ""].join(String.fromCharCode(10))),
    });
    await imp.getByRole("button", { name: "Import", exact: true }).click();
    await expect(imp.getByText("Import finished")).toBeVisible();
    await expect(imp.getByText(/2 created, 0 updated, 1 duplicate rows skipped, 1 invalid/)).toBeVisible();
    await imp.getByRole("button", { name: "Done" }).click();
    await page.goto("/dashboard/contacts?q=Karim");
    await expect(page.getByText("Karim").first()).toBeVisible();
  });

  await test.step("sender ID request with a document; download is tenant-checked by Laravel", async () => {
    // 1×1 PNG (Laravel checks size, type, extension and magic bytes).
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
    const value = `E2E${run.slice(-6)}`.toUpperCase().slice(0, 11);
    await page.goto("/dashboard/sender-ids");
    await page.getByRole("button", { name: "Request sender ID" }).first().click();
    const d = page.getByRole("dialog");
    await d.locator('select[name="type"]').selectOption("MASKING");
    await d.locator('input[name="value"]').fill(value);
    await d.locator('textarea[name="purpose"]').fill("Order confirmations and delivery updates");
    await d.locator('textarea[name="sampleMessage"]').fill("Your order 123 has been shipped. Thank you.");
    await d.locator('input[name="documents"]').setInputFiles({ name: "licence.png", mimeType: "image/png", buffer: png });
    await d.getByRole("button", { name: "Submit request" }).click();
    await expect(page.getByText(value).first()).toBeVisible();
    const href = await page.locator('a[href*="/api/v1/app/sender-ids/"][href$="/documents/0"]').first().getAttribute("href");
    expect(href).toBeTruthy();
    const doc = await page.request.get(href!);
    expect(doc.status()).toBe(200);
    expect(doc.headers()["content-type"]).toContain("image/png");
    expect(Buffer.from(await doc.body()).subarray(0, 4).toString("hex")).toBe("89504e47");
    // Another (signed-out) client gets nothing.
    const anon = await page.context().browser()!.newContext({ baseURL: page.url() });
    expect((await anon.request.get(href!)).status()).toBeGreaterThanOrEqual(400);
    await anon.close();
  });

  await test.step("wallet: top up with the mock gateway", async () => {
    await page.goto("/dashboard/wallet");
    await page.getByText("Custom", { exact: true }).click();
    await page.locator('input[name="amount"]').fill("500");
    await page.locator("label").filter({ hasText: "Test only" }).click();
    await page.getByRole("button", { name: "Continue to payment" }).click();
    await page.waitForURL(/\/dashboard\/wallet\/mock-checkout\//);
    await page.getByRole("button", { name: "Simulate successful payment" }).click();
    await page.waitForURL((u) => !u.pathname.includes("mock-checkout"));
    await page.goto("/dashboard/wallet");
    await expect(page.getByText(/500\.00/).first()).toBeVisible();
  });

  let campaignUrl = "";
  await test.step("campaign to two numbers", async () => {
    await page.goto("/dashboard/send");
    await page.getByPlaceholder("01712345678").fill("01712345671\n01812345672");
    await page.locator("#composer-message").fill(`Hello from the Laravel E2E run ${run}`);
    await page.getByRole("button", { name: "Review and send" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Review before sending")).toBeVisible();
    await dialog.getByRole("button", { name: "Send to 2" }).click();
    await page.waitForURL(/\/dashboard\/campaigns\/[0-9a-f-]{36}$/);
    campaignUrl = page.url();
  });

  await test.step("delivery reports arrive (Laravel worker, mock provider)", async () => {
    for (const shown of ["+880 1712-345671", "+880 1812-345672"]) {
      await expect
        .poll(
          async () => {
            await page.goto(campaignUrl);
            return (await page.getByRole("row").filter({ hasText: shown }).textContent()) ?? "";
          },
          { timeout: 120_000, intervals: [3000] },
        )
        .toContain("Delivered");
    }
  });

  await test.step("reports and message detail", async () => {
    await page.goto("/dashboard/reports");
    await expect(page.getByText("+880 1712-345671").first()).toBeVisible();
    await page.getByRole("link", { name: "View" }).first().click();
    await expect(page.getByText("Delivery history")).toBeVisible();
    const report = await page.request.get("/api/v1/app/reports/export");
    expect(report.status()).toBe(200);
    expect(await report.text()).toContain("8801712345671");
  });

  await test.step("transactions show the top-up and the SMS charge", async () => {
    await page.goto("/dashboard/transactions");
    // BDT formatting and amounts: 500.00 credited, 2 × 1 segment × 0.40 charged.
    await expect(page.getByRole("row").filter({ hasText: "Top-up" }).filter({ hasText: "+BDT 500.00" })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "SMS charge" }).filter({ hasText: "BDT 0.80" })).toBeVisible();
    await expect(page.getByText("BDT 499.20").first()).toBeVisible();
  });

  await test.step("API key is shown once", async () => {
    await page.goto("/dashboard/api");
    await page.getByRole("button", { name: "Create API key" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.locator('input[name="name"]').fill("E2E Laravel server");
    await dialog.getByRole("button", { name: "Create key" }).click();
    await expect(dialog.getByTestId("secret-value")).toHaveText(/^sfk_live_[A-Za-z0-9]{8}_\S{20,}$/);
    await dialog.getByRole("button", { name: "I have copied the key" }).click();
    expect(await page.content()).not.toMatch(/sfk_live_[A-Za-z0-9]{8}_[A-Za-z0-9_-]{20,}/);
  });

  await test.step("logout, then login again", async () => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await page.waitForURL(/\/login/);
    // The session was revoked in Laravel and the cookie removed: the dashboard needs a new sign-in.
    expect((await page.context().cookies()).some((c) => /sf_session$/.test(c.name))).toBe(false);
    await page.goto("/dashboard");
    await page.waitForURL(/\/login/);
    await page.locator('input[name="identifier"]').fill(email);
    await page.locator('input[name="password"]').fill("wrong-password-123");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText(/incorrect|invalid/i).first()).toBeVisible();
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(/\/dashboard/);
    await expect(page.getByRole("heading", { name: /Welcome back, E2E/ })).toBeVisible();
  });

  expect(leaked, "the browser must only talk to Next.js").toEqual([]);
  expect(pageErrors).toEqual([]);
});

/**
 * Admin panel on the Laravel admin API. Needs a local platform admin:
 *   E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD (a user whose platformRole is SUPER_ADMIN in the local DB).
 */
test("admin pages and a review action on the Laravel API", async ({ page }) => {
  test.skip(!process.env.E2E_ADMIN_EMAIL || !process.env.E2E_ADMIN_PASSWORD, "set E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD");
  const leaked = watchBrowserRequests(page);
  await page.goto("/login");
  await page.locator('input[name="identifier"]').fill(process.env.E2E_ADMIN_EMAIL!);
  await page.locator('input[name="password"]').fill(process.env.E2E_ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/(admin|dashboard)/);

  for (const path of ["/admin", "/admin/customers", "/admin/campaigns", "/admin/sender-ids", "/admin/payments", "/admin/wallets", "/admin/support", "/admin/users", "/admin/abuse", "/admin/messages?to=01712345671", "/admin/audit-logs", "/admin/api-logs", "/admin/pricing", "/admin/settings", "/admin/roles"]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    await expect(page.locator("h1").first(), path).toBeVisible();
    await expect(page.getByText("Something went wrong"), path).toHaveCount(0);
  }

  await test.step("customer detail", async () => {
    await page.goto("/admin/customers");
    await page.getByRole("link", { name: /E2E Laravel Shop/ }).first().click();
    await page.waitForURL(/\/admin\/customers\/[0-9a-f-]{36}$/);
    await expect(page.getByText("E2E Laravel").first()).toBeVisible();
  });

  await test.step("approve the pending sender ID (audited by Laravel)", async () => {
    await page.goto("/admin/sender-ids?status=PENDING");
    const approve = page.getByRole("button", { name: "Approve" }).first();
    if (await approve.count()) {
      await approve.click();
      await page.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
      await expect(page.getByText(/Sender ID approved/i).first()).toBeVisible();
    }
  });

  expect(leaked, "the browser must only talk to Next.js").toEqual([]);
});

/** The remaining customer pages and the endpoints this domain proxies to Laravel. Runs after the journey (same account). */
test("remaining pages, marketing forms and the proxied customer API on Laravel", async ({ page }) => {
  const leaked = watchBrowserRequests(page);
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto("/login");
  await page.locator('input[name="identifier"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/dashboard/);

  await test.step("templates", async () => {
    await page.goto("/dashboard/templates");
    await page.getByRole("button", { name: "New template" }).first().click();
    const d = page.getByRole("dialog");
    await d.locator('input[name="name"]').fill("Order shipped");
    await d.locator('textarea[name="body"]').fill("Hi {{name}}, your order has shipped.");
    await d.getByRole("button", { name: "Create template" }).click();
    await expect(page.getByText("Order shipped").first()).toBeVisible();
  });

  await test.step("team invitation", async () => {
    await page.goto("/dashboard/team");
    await page.getByRole("button", { name: "Invite member" }).first().click();
    const d = page.getByRole("dialog");
    await d.locator('input[name="email"]').fill(`teammate-${run}@example.com`);
    await d.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByText(`teammate-${run}@example.com`).first()).toBeVisible();
  });

  await test.step("support ticket and reply", async () => {
    await page.goto("/dashboard/support");
    await page.getByRole("button", { name: "New ticket" }).first().click();
    const d = page.getByRole("dialog");
    await d.locator('input[name="subject"]').fill("Delivery question");
    await d.locator('textarea[name="message"]').fill("Are reports for Grameenphone numbers delayed today?");
    await d.getByRole("button", { name: "Submit ticket" }).click();
    await page.waitForURL(/\/dashboard\/support\/[0-9a-f-]{36}/);
    await page.locator('textarea[name="body"]').fill("Adding more details about the campaign.");
    await page.getByRole("button", { name: "Send reply" }).click();
    await expect(page.getByText("Adding more details about the campaign.").first()).toBeVisible();
  });

  await test.step("settings: profile saved through Laravel", async () => {
    await page.goto("/dashboard/settings");
    await page.locator('input[name="name"]').first().fill("E2E Laravel Renamed");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Profile saved.").first()).toBeVisible();
  });

  for (const path of ["/dashboard/notifications", "/dashboard/campaigns", "/dashboard/api/webhooks", "/dashboard/contacts/groups", "/dashboard/contacts/suppression"]) {
    await test.step(`page ${path}`, async () => {
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await expect(page.locator("h1").first()).toBeVisible();
      await expect(page.getByText("Something went wrong")).toHaveCount(0);
    });
  }

  let apiKey = "";
  await test.step("customer API through this domain (proxied to Laravel)", async () => {
    await page.goto("/dashboard/api");
    await page.getByRole("button", { name: "Create API key" }).first().click();
    const d = page.getByRole("dialog");
    await d.locator('input[name="name"]').fill("Proxy check");
    await d.getByRole("button", { name: "Create key" }).click();
    apiKey = (await d.getByTestId("secret-value").textContent())!.trim();
    await d.getByRole("button", { name: "I have copied the key" }).click();

    const est = await page.request.post("/api/v1/sms/estimate", { headers: { Authorization: `Bearer ${apiKey}` }, data: { message: "Hello", recipients: 2 } });
    expect(est.status(), await est.text()).toBe(200);
    expect(est.headers()["x-request-id"]).toMatch(/^req_/);
    // The default key has no balance:read scope: Laravel enforces scopes on the proxied request.
    const bal = await page.request.get("/api/v1/balance", { headers: { Authorization: `Bearer ${apiKey}` } });
    expect(bal.status()).toBe(403);
    expect((await bal.json()).error.code).toBe("INSUFFICIENT_SCOPE");
    const senders = await page.request.get("/api/v1/sender-ids", { headers: { Authorization: `Bearer ${apiKey}` } });
    expect(senders.status()).toBe(200);
    expect((await senders.json()).success).toBe(true);
    expect((await page.request.get("/api/v1/balance", { headers: { Authorization: "Bearer sfk_live_invalid_key" } })).status()).toBe(401);
    await page.goto("/dashboard/api/logs");
    await expect(page.getByText("/api/v1/sender-ids").first()).toBeVisible();
  });

  await test.step("provider webhook through this domain reaches Laravel", async () => {
    const res = await page.request.post("/api/v1/webhooks/sms/mock", { data: { message_id: "does-not-exist", status: "delivered" } });
    expect(res.headers()["x-request-id"] ?? "").toMatch(/^req_/);
    expect(res.status()).toBeLessThan(500);
  });

  await test.step("marketing pages and the contact form", async () => {
    for (const p of ["/", "/pricing", "/contact"]) {
      const res = await page.goto(p);
      expect(res?.status(), p).toBe(200);
    }
    await page.locator('input[name="name"]').fill("Prospect Person");
    await page.locator('input[name="email"]').fill(`prospect-${run}@example.com`);
    await page.locator('textarea[name="message"]').fill("We would like enterprise pricing for 1M SMS per month.");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText(/Thanks for getting in touch/).first()).toBeVisible();
  });

  expect(leaked, "the browser must only talk to Next.js").toEqual([]);
  expect(pageErrors).toEqual([]);
});
