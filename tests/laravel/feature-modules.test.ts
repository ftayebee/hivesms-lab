import { beforeAll, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/auth/context";
import { LaravelApiError } from "@/lib/laravel-api";
import { tenantFromMe } from "@/lib/laravel/session";
import * as templates from "@/features/templates/service";
import * as team from "@/features/team/service";
import * as support from "@/features/support/service";
import * as settings from "@/features/settings/service";
import { api, me, mockTopUp, PASSWORD, register, RUN, type TestAccount } from "../support/laravel-helpers";

/**
 * Templates, team, support, settings and notifications with LARAVEL_FEATURES=all: the same service
 * functions the pages and server actions call, answered by a LOCAL Laravel. The browser's session
 * cookie is simulated by mocking next/headers (what the Next.js server reads per request).
 * Run command: see tests/laravel/proxy-routes.test.ts.
 */

const scope = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "sf_session" && scope.token ? { name, value: scope.token } : undefined) }),
  headers: async () => new Headers({ "user-agent": "vitest-laravel-cutover" }),
}));

/** Runs `fn` as the given account, like a request carrying that account's session cookie. */
async function as<T>(acc: TestAccount, fn: () => Promise<T>): Promise<T> {
  scope.token = acc.token;
  try {
    return await fn();
  } finally {
    scope.token = undefined;
  }
}

const failure = async (p: Promise<unknown>) => {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err, "expected the call to fail").toBeInstanceOf(LaravelApiError);
  return err as LaravelApiError;
};

let a: TestAccount;
let b: TestAccount;
let ctxA: TenantContext;
let ctxB: TenantContext;

beforeAll(async () => {
  a = await register("mod-a", { verified: true });
  b = await register("mod-b", { verified: true });
  ctxA = tenantFromMe(await me(a.token))!;
  ctxB = tenantFromMe(await me(b.token))!;
});

describe("templates", () => {
  it("create, list, search, update and delete", async () => {
    const t = await as(a, () => templates.saveTemplate(ctxA, templates.templateSchema.parse({ name: `Welcome ${RUN}`, body: "Hello {name}", smsType: "TRANSACTIONAL" })));
    expect(t.id).toBeTruthy();
    expect(t.createdAt).toBeInstanceOf(Date);

    const found = await as(a, () => templates.listTemplates(ctxA, `Welcome ${RUN}`));
    expect(found.map((x) => x.id)).toEqual([t.id]);

    const updated = await as(a, () => templates.saveTemplate(ctxA, { name: `Welcome ${RUN}`, body: "Hi again", smsType: "PROMOTIONAL" }, t.id));
    expect(updated.body).toBe("Hi again");
    expect(updated.smsType).toBe("PROMOTIONAL");

    await as(a, () => templates.deleteTemplate(ctxA, t.id));
    expect((await as(a, () => templates.listTemplates(ctxA))).map((x) => x.id)).not.toContain(t.id);
  });

  it("Laravel validation reaches the form as field errors", async () => {
    const err = await failure(as(a, () => templates.saveTemplate(ctxA, { name: "", body: "", smsType: "TRANSACTIONAL" })));
    expect(err.kind).toBe("validation");
    expect(err.status).toBe(422);
  });

  it("another organization's template is 404 for read-modify-delete and never listed", async () => {
    const t = await as(a, () => templates.saveTemplate(ctxA, { name: `Private ${RUN}`, body: "Secret", smsType: "TRANSACTIONAL" }));
    expect((await failure(as(b, () => templates.saveTemplate(ctxB, { name: "Mallory", body: "x", smsType: "TRANSACTIONAL" }, t.id)))).kind).toBe("not_found");
    expect((await failure(as(b, () => templates.deleteTemplate(ctxB, t.id)))).kind).toBe("not_found");
    expect((await as(b, () => templates.listTemplates(ctxB))).map((x) => x.id)).not.toContain(t.id);
    expect((await as(a, () => templates.listTemplates(ctxA))).map((x) => x.id)).toContain(t.id);
  });
});

describe("team", () => {
  it("lists the owner and roles; invites and revokes an invitation", async () => {
    const t = await as(a, () => team.listTeam(ctxA));
    expect(t.members).toHaveLength(1);
    expect(t.members[0].role.key).toBe("OWNER");
    expect(t.members[0].user.email).toBe(a.email);
    expect(t.roles.map((r) => r.key)).toEqual(expect.arrayContaining(["OWNER", "VIEWER"]));

    const email = `invitee-${RUN}@example.com`;
    const inv = await as(a, () => team.inviteMember(ctxA, team.inviteSchema.parse({ email, role: "VIEWER" })));
    expect(inv.email).toBe(email);
    const after = await as(a, () => team.listTeam(ctxA));
    expect(after.invitations.map((i) => i.email)).toContain(email);
    expect(after.invitations.find((i) => i.email === email)!.expiresAt).toBeInstanceOf(Date);

    // Not visible to, and not revocable by, another organization.
    expect((await as(b, () => team.listTeam(ctxB))).invitations.map((i) => i.email)).not.toContain(email);
    expect((await failure(as(b, () => team.revokeInvitation(ctxB, inv.id)))).kind).toBe("not_found");

    await as(a, () => team.revokeInvitation(ctxA, inv.id));
    expect((await as(a, () => team.listTeam(ctxA))).invitations.map((i) => i.email)).not.toContain(email);
  });

  it("the last owner cannot demote or disable themselves", async () => {
    const owner = (await as(a, () => team.listTeam(ctxA))).members[0];
    const demote = await failure(as(a, () => team.changeMemberRole(ctxA, owner.id, "VIEWER")));
    expect([403, 409, 422]).toContain(demote.status);
    const disable = await failure(as(a, () => team.setMemberStatus(ctxA, owner.id, "disable")));
    expect([403, 409, 422]).toContain(disable.status);
    expect((await as(a, () => team.listTeam(ctxA))).members[0].role.key).toBe("OWNER");
  });

  it("another organization's member ids are 404", async () => {
    const owner = (await as(a, () => team.listTeam(ctxA))).members[0];
    expect((await failure(as(b, () => team.changeMemberRole(ctxB, owner.id, "VIEWER")))).kind).toBe("not_found");
    expect((await failure(as(b, () => team.setMemberStatus(ctxB, owner.id, "remove")))).kind).toBe("not_found");
  });
});

describe("support", () => {
  it("create, list, read, reply and close a ticket", async () => {
    const created = await as(a, () => support.createTicket(ctxA, support.ticketSchema.parse({ subject: `Delivery delay ${RUN}`, category: "Delivery", priority: "HIGH", message: "Messages are delayed since this morning." })));
    expect(created.number).toBeGreaterThan(0);
    expect(created.status).toBe("OPEN");

    const list = await as(a, () => support.listTickets(ctxA, { page: 1 }));
    expect(list.rows.map((r) => r.id)).toContain(created.id);
    expect(list.total).toBeGreaterThanOrEqual(1);

    await as(a, () => support.replyToTicket(ctxA, created.id, "Any update please?"));
    const full = await as(a, () => support.getTicket(ctxA, created.id));
    expect(full.messages.map((m) => m.body)).toEqual(expect.arrayContaining(["Messages are delayed since this morning.", "Any update please?"]));
    expect(full.messages.every((m) => m.isInternal === false)).toBe(true);
    expect(full.messages[0].createdAt).toBeInstanceOf(Date);

    await as(a, () => support.closeTicket(ctxA, created.id));
    expect((await as(a, () => support.getTicket(ctxA, created.id))).status).toBe("CLOSED");
  });

  it("another organization's ticket is 404 and not listed", async () => {
    const t = await as(a, () => support.createTicket(ctxA, { subject: `Private ticket ${RUN}`, category: "Billing", priority: "NORMAL", message: "Please check my invoice." }));
    expect((await failure(as(b, () => support.getTicket(ctxB, t.id)))).kind).toBe("not_found");
    expect((await failure(as(b, () => support.replyToTicket(ctxB, t.id, "Mallory was here")))).kind).toBe("not_found");
    expect((await failure(as(b, () => support.closeTicket(ctxB, t.id)))).kind).toBe("not_found");
    expect((await as(b, () => support.listTickets(ctxB, { page: 1 }))).rows.map((r) => r.id)).not.toContain(t.id);
  });

  it("validation errors from Laravel (too short subject)", async () => {
    const err = await failure(as(a, () => support.createTicket(ctxA, { subject: "x", category: "General", priority: "NORMAL", message: "short" })));
    expect(err.kind).toBe("validation");
  });
});

describe("settings (profile)", () => {
  it("reads and updates the profile and organization of the session only", async () => {
    const userId = ctxA.userId!;
    const p = await as(a, () => settings.getProfile(userId));
    expect(p.email).toBe(a.email);

    await as(a, () => settings.updateProfile(userId, settings.profileSchema.parse({ name: `Renamed ${RUN}` })));
    expect((await as(a, () => settings.getProfile(userId))).name).toBe(`Renamed ${RUN}`);
    // Passing another user's id changes nothing: Laravel uses the session's user.
    expect((await as(b, () => settings.getProfile(userId))).email).toBe(b.email);

    await as(a, () => settings.updateOrganization(ctxA, settings.organizationSchema.parse({ name: `Org ${RUN}`, website: "https://example.com" })));
    const org = await as(a, () => settings.getOrganizationSettings(ctxA));
    expect(org.name).toBe(`Org ${RUN}`);
    expect(org.website).toBe("https://example.com");
    expect((await as(b, () => settings.getOrganizationSettings(ctxB))).name).not.toBe(`Org ${RUN}`);
  });

  it("rejects invalid input with a validation error", async () => {
    const err = await failure(as(a, () => settings.updateOrganization(ctxA, { name: "", industry: null, website: "not a url", address: null } as never)));
    expect(err.kind).toBe("validation");
  });

  it("lists sessions and revokes another session of the same user", async () => {
    const second = await api<{ token: string }>("auth/login", { body: { identifier: a.email, password: PASSWORD } });
    expect(second.status).toBe(200);
    const sessions = await as(a, () => settings.listSessions(ctxA.userId!));
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    expect(sessions[0].lastSeenAt).toBeInstanceOf(Date);
    const other = (await api<{ session: { id: string } }>("auth/me", { token: second.json!.data.token })).json!.data.session.id;
    await as(a, () => settings.revokeOwnSession(ctxA.userId!, other, ""));
    expect((await api("auth/me", { token: second.json!.data.token })).status).toBe(401);
    expect((await api("auth/me", { token: a.token })).status).toBe(200);
    // B cannot revoke A's session.
    const aSession = (await me(a.token)).session.id;
    expect((await failure(as(b, () => settings.revokeOwnSession(ctxB.userId!, aSession, "")))).kind).toBe("not_found");
    expect((await api("auth/me", { token: a.token })).status).toBe(200);
  });

  it("notification preferences round-trip", async () => {
    const prefs = await as(a, () => settings.getNotificationPrefs(ctxA.userId!));
    expect(prefs.length).toBeGreaterThan(0);
    const flipped = prefs.map((p, i) => ({ type: p.type, inApp: p.inApp, email: i === 0 ? !p.email : p.email }));
    await as(a, () => settings.saveNotificationPrefs(ctxA.userId!, flipped));
    const back = await as(a, () => settings.getNotificationPrefs(ctxA.userId!));
    expect(back.find((p) => p.type === prefs[0].type)!.email).toBe(!prefs[0].email);
  });

  it("the only owner cannot leave the organization", async () => {
    const err = await failure(as(a, () => settings.leaveOrganization(ctxA)));
    expect([403, 409, 422]).toContain(err.status);
    expect((await me(a.token)).organization?.id).toBe(a.organizationId);
  });
});

describe("notifications", () => {
  it("lists the organization's notifications and marks them read; another organization sees none of them", async () => {
    // A completed (mock) top-up notifies the organization.
    await mockTopUp(a.token, 500);
    const list = await as(a, () => settings.listNotifications(ctxA, 1));
    expect(list.total).toBeGreaterThanOrEqual(1);
    expect(list.rows[0].createdAt).toBeInstanceOf(Date);
    const ids = list.rows.map((n) => n.id);

    // B marking A's ids read has no effect on A.
    const unreadBefore = list.unread;
    await as(b, () => settings.markNotificationsRead(ctxB, ids));
    expect((await as(a, () => settings.listNotifications(ctxA, 1))).unread).toBe(unreadBefore);
    expect((await as(b, () => settings.listNotifications(ctxB, 1))).rows.map((n) => n.id)).not.toEqual(expect.arrayContaining(ids));

    await as(a, () => settings.markNotificationsRead(ctxA, [ids[0]]));
    const after = await as(a, () => settings.listNotifications(ctxA, 1));
    expect(after.rows.find((n) => n.id === ids[0])!.readAt).toBeInstanceOf(Date);
    await as(a, () => settings.markNotificationsRead(ctxA));
    expect((await as(a, () => settings.listNotifications(ctxA, 1))).unread).toBe(0);
  });
});
