import { describe, expect, it } from "vitest";
import { isDatabaseUnavailable, uniqueViolationTarget } from "@/lib/db-errors";

// Shapes produced by Prisma 7 with @prisma/adapter-mariadb.
const unique = (index: string) =>
  Object.assign(new Error(`Unique constraint failed on the constraint: \`${index}\``), {
    code: "P2002",
    meta: { modelName: "User", driverAdapterError: { cause: { kind: "UniqueConstraintViolation", constraint: { index } } } },
  });

describe("database error classification", () => {
  it("identifies which unique index was violated", () => {
    expect(uniqueViolationTarget(unique("users_email_key"))).toMatch(/email/);
    expect(uniqueViolationTarget(unique("users_phone_key"))).toMatch(/phone/);
    expect(uniqueViolationTarget(new Error("Duplicate entry 'a@b.c' for key 'users.users_email_key'"))).toMatch(/email/);
    expect(uniqueViolationTarget(new Error("boom"))).toBeNull();
  });

  it("detects an unavailable database", () => {
    expect(isDatabaseUnavailable(Object.assign(new Error("Can't reach database server"), { code: "P1001" }))).toBe(true);
    expect(isDatabaseUnavailable(Object.assign(new Error("The table `users` does not exist"), { code: "P2021" }))).toBe(true);
    expect(isDatabaseUnavailable(Object.assign(new Error("x"), { name: "PrismaClientInitializationError" }))).toBe(true);
    expect(isDatabaseUnavailable(new Error("connect ECONNREFUSED 127.0.0.1:3306"))).toBe(true);
    expect(isDatabaseUnavailable({ code: "P2010", message: "x", meta: { driverAdapterError: { cause: { kind: "AuthenticationFailed" } } } })).toBe(true);
    expect(isDatabaseUnavailable(unique("users_email_key"))).toBe(false);
    expect(isDatabaseUnavailable(new Error("boom"))).toBe(false);
  });
});
