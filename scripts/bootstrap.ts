/**
 * Production bootstrap. Safe to run on every deploy (idempotent), unlike the demo seed.
 *
 *   npm run db:bootstrap
 *   BOOTSTRAP_ADMIN_EMAIL=ops@your-company.example npm run db:bootstrap
 *
 * - Creates or refreshes the permission catalogue.
 * - Creates the example pricing plans and credit packages only if they are missing, so edits
 *   made in Admin → Pricing are never overwritten.
 * - With BOOTSTRAP_ADMIN_EMAIL and no active super admin yet: creates that user as super admin with
 *   a one-time random password printed to this terminal (not to the application log), or promotes an
 *   existing user. Ignored once a super admin exists. Prefer `php artisan platform:bootstrap-owner`.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { defaultCreditPackages, defaultPlans } from "@/config/pricing";
import { ensurePermissionCatalogue } from "@/features/organizations/provision";

async function main() {
  await ensurePermissionCatalogue();
  console.log("✓ permission catalogue");

  let plans = 0;
  for (const p of defaultPlans) {
    const existing = await db.pricingPlan.findUnique({ where: { key: p.key } });
    if (!existing) {
      await db.pricingPlan.create({ data: p });
      plans++;
    }
  }
  console.log(`✓ pricing plans (${plans} created; existing plans untouched)`);

  if ((await db.creditPackage.count()) === 0) {
    for (const p of defaultCreditPackages) await db.creditPackage.create({ data: p });
    console.log(`✓ credit packages (${defaultCreditPackages.length} created)`);
  } else {
    console.log("✓ credit packages (already configured)");
  }

  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  // One-time only (docs/18): once an active super admin exists, owners are added in Admin → Users by an
  // existing owner (reason + password, audited). The preferred bootstrap is the Laravel command
  // `php artisan platform:bootstrap-owner`, which also asks for explicit confirmation.
  const owners = email ? await db.user.count({ where: { platformRole: "SUPER_ADMIN", status: "ACTIVE", deletedAt: null } }) : 0;
  if (email && owners > 0) {
    console.log("! BOOTSTRAP_ADMIN_EMAIL ignored: an active super admin already exists. Unset it and add owners from the admin panel.");
  } else if (email) {
    const user = await db.user.findUnique({ where: { email } });
    if (user) {
      if (user.platformRole !== "SUPER_ADMIN") {
        await db.user.update({ where: { id: user.id }, data: { platformRole: "SUPER_ADMIN" } });
        await db.auditLog.create({ data: { actorType: "SYSTEM", action: "admin.bootstrap_promoted", targetType: "user", targetId: user.id } });
      }
      console.log(`✓ super admin: ${email} (existing user; password unchanged)`);
    } else {
      const password = `${randomBytes(18).toString("base64url")}-A7`;
      const created = await db.user.create({
        data: { email, name: "Platform administrator", passwordHash: await hashPassword(password), platformRole: "SUPER_ADMIN", emailVerifiedAt: new Date() },
      });
      await db.auditLog.create({ data: { actorType: "SYSTEM", action: "admin.bootstrap_created", targetType: "user", targetId: created.id } });
      console.log(`✓ super admin created: ${email}`);
      console.log(`  One-time password (shown once, change it after signing in): ${password}`);
    }
  }
}

main()
  .then(() => db.$disconnect())
  .catch(async (err) => {
    console.error("Bootstrap failed:", err instanceof Error ? err.message : err);
    await db.$disconnect();
    process.exit(1);
  });
