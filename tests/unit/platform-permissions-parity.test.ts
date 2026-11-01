import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PLATFORM_PERMISSIONS, platformCan } from "@/lib/auth/permissions";

/**
 * The platform permission matrix exists twice: backend/app/Auth/Permissions.php (enforced by the
 * API) and src/lib/auth/permissions.ts (decides what the admin UI renders). They must be identical,
 * or the UI would show controls the API refuses — or hide ones it allows.
 */
function phpMatrix(): Record<string, string[]> {
  const php = readFileSync(path.resolve(__dirname, "../../backend/app/Auth/Permissions.php"), "utf8");
  const block = php.slice(php.indexOf("public const PLATFORM = ["), php.indexOf("];", php.indexOf("public const PLATFORM = [")));
  const out: Record<string, string[]> = {};
  for (const m of block.matchAll(/'([a-z:_]+)'\s*=>\s*\[([^\]]*)\]/g)) {
    out[m[1]] = [...m[2].matchAll(/'([A-Z_]+)'/g)].map((r) => r[1]).sort();
  }
  return out;
}

describe("platform permissions", () => {
  it("are identical in Laravel and Next.js", () => {
    const ts = Object.fromEntries(Object.entries(PLATFORM_PERMISSIONS).map(([k, v]) => [k, [...v].sort()]));
    expect(phpMatrix()).toEqual(ts);
  });

  it("never give customers or support staff money, pricing-cost or staff powers", () => {
    for (const p of ["admin:wallet:adjust", "admin:payments:refund", "admin:costs:manage", "admin:pricing:customer", "admin:users:manage", "admin:settings:manage", "admin:finance:read", "admin:billing:manage", "admin:reports:export"] as const) {
      expect(platformCan("USER", p), p).toBe(false);
      expect(platformCan("SUPPORT", p), p).toBe(false);
    }
    for (const p of Object.keys(PLATFORM_PERMISSIONS) as Array<keyof typeof PLATFORM_PERMISSIONS>) expect(platformCan("USER", p), p).toBe(false);
  });

  it("keep money-moving and owner-level permissions for super admins only", () => {
    for (const p of ["admin:wallet:adjust", "admin:payments:refund", "admin:costs:manage", "admin:pricing:customer", "admin:users:manage", "admin:settings:manage"] as const) {
      expect(PLATFORM_PERMISSIONS[p]).toEqual(["SUPER_ADMIN"]);
    }
  });
});
