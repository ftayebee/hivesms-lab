import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, hasPermission, platformCan, SYSTEM_ROLES } from "@/lib/auth/permissions";
import { assertOrgActive, requirePermission, type TenantContext } from "@/lib/auth/context";

const ctx = (permissions: string[], status: "ACTIVE" | "SUSPENDED" = "ACTIVE"): TenantContext => ({
  organizationId: "o",
  organizationStatus: status,
  userId: "u",
  apiKeyId: null,
  roleKey: "X",
  permissions,
});

describe("organization roles", () => {
  it("gives owners and admins every permission", () => {
    expect(SYSTEM_ROLES.OWNER.permissions).toEqual(ALL_PERMISSIONS);
    expect(SYSTEM_ROLES.ADMIN.permissions).toEqual(ALL_PERMISSIONS);
  });

  it("keeps viewers read-only", () => {
    const writes = SYSTEM_ROLES.VIEWER.permissions.filter((p) => /:(write|manage|export)$|sms:send/.test(p));
    expect(writes).toEqual([]);
  });

  it("lets developers manage API keys but not billing or sending", () => {
    const dev = SYSTEM_ROLES.DEVELOPER.permissions;
    expect(dev).toContain("api_keys:manage");
    expect(dev).not.toContain("billing:manage");
    expect(dev).not.toContain("sms:send");
  });

  it("does not let managers change the team or billing", () => {
    expect(SYSTEM_ROLES.MANAGER.permissions).not.toContain("team:manage");
    expect(SYSTEM_ROLES.MANAGER.permissions).not.toContain("billing:manage");
  });

  it("checks single and multiple permissions", () => {
    expect(hasPermission(["a:b", "c:d"] as never, ["a:b", "c:d"] as never)).toBe(true);
    expect(hasPermission(["a:b"] as never, ["a:b", "c:d"] as never)).toBe(false);
  });

  it("throws FORBIDDEN when a permission is missing", () => {
    expect(() => requirePermission(ctx(["contacts:read"]), "contacts:write")).toThrowError(/permission/);
    expect(() => requirePermission(ctx(["contacts:write"]), "contacts:write")).not.toThrow();
  });

  it("blocks suspended organizations", () => {
    expect(() => assertOrgActive(ctx([], "SUSPENDED"))).toThrowError(/suspended/);
  });
});

describe("platform roles", () => {
  it("never grants admin access to regular users", () => {
    expect(platformCan("USER", "admin:access")).toBe(false);
  });
  it("limits support staff", () => {
    expect(platformCan("SUPPORT", "admin:support")).toBe(true);
    expect(platformCan("SUPPORT", "admin:pricing:manage")).toBe(false);
    expect(platformCan("SUPPORT", "admin:billing:manage")).toBe(false);
  });
  it("reserves user management and settings for super admins", () => {
    expect(platformCan("ADMIN", "admin:users:manage")).toBe(false);
    expect(platformCan("SUPER_ADMIN", "admin:users:manage")).toBe(true);
    expect(platformCan("ADMIN", "admin:settings:manage")).toBe(false);
  });
});
