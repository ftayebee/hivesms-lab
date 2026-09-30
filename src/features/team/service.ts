import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { randomToken, sha256 } from "@/lib/crypto";
import { actorOf, requirePermission, type TenantContext } from "@/lib/auth/context";
import { ALL_PERMISSIONS, type SystemRoleKey } from "@/lib/auth/permissions";
import { hashPassword } from "@/lib/auth/password";
import { sendEmail } from "@/services/email";
import { emailTemplates } from "@/services/email/templates";
import { notify } from "@/services/notify";

const INVITE_DAYS = 7;
const ROLE_KEYS = ["OWNER", "ADMIN", "MANAGER", "DEVELOPER", "VIEWER"] as const;

export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.")),
  role: z.enum(ROLE_KEYS),
});

export async function listTeam(ctx: TenantContext) {
  requirePermission(ctx, "team:read");
  const [members, invitations, roles] = await Promise.all([
    db.organizationMember.findMany({
      where: { organizationId: ctx.organizationId },
      include: { user: { select: { id: true, name: true, email: true, lastLoginAt: true, emailVerifiedAt: true } }, role: { select: { key: true, name: true } } },
      orderBy: { joinedAt: "asc" },
    }),
    db.invitation.findMany({ where: { organizationId: ctx.organizationId, acceptedAt: null, revokedAt: null }, include: { role: { select: { key: true, name: true } } }, orderBy: { createdAt: "desc" } }),
    db.role.findMany({ where: { organizationId: ctx.organizationId }, include: { permissions: { include: { permission: { select: { key: true } } } } } }),
  ]);
  const order = (k: string) => ROLE_KEYS.indexOf(k as SystemRoleKey);
  return {
    members,
    invitations,
    roles: roles.sort((a, b) => order(a.key) - order(b.key)).map((r) => ({ id: r.id, key: r.key, name: r.name, description: r.description, permissions: r.permissions.map((p) => p.permission.key) })),
  };
}

function isOwner(ctx: TenantContext) {
  return ctx.roleKey === "OWNER";
}

export async function inviteMember(ctx: TenantContext, input: z.infer<typeof inviteSchema>) {
  requirePermission(ctx, "team:manage");
  if (input.role === "OWNER" && !isOwner(ctx)) throw new AppError("FORBIDDEN", "Only owners can invite another owner.");
  const role = await db.role.findUniqueOrThrow({ where: { organizationId_key: { organizationId: ctx.organizationId, key: input.role } } });
  const existingMember = await db.organizationMember.findFirst({ where: { organizationId: ctx.organizationId, user: { email: input.email } } });
  if (existingMember) throw new AppError("CONFLICT", "This person is already a member.", { field: "email" });
  const pending = await db.invitation.count({ where: { organizationId: ctx.organizationId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } });
  if (pending >= 50) throw new AppError("VALIDATION_ERROR", "Too many pending invitations. Revoke some first.");
  await db.invitation.updateMany({ where: { organizationId: ctx.organizationId, email: input.email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });

  const token = randomToken(32);
  const inv = await db.invitation.create({
    data: { organizationId: ctx.organizationId, email: input.email, roleId: role.id, tokenHash: sha256(token), invitedById: ctx.userId!, expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000) },
  });
  const [org, inviter] = await Promise.all([
    db.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { name: true } }),
    db.user.findUniqueOrThrow({ where: { id: ctx.userId! }, select: { name: true } }),
  ]);
  await sendEmail(emailTemplates.invitation(input.email, org.name, inviter.name, role.name, `${process.env.APP_URL ?? "http://localhost:3000"}/invite/${token}`));
  await audit({ action: "team.invite", actor: actorOf(ctx), organizationId: ctx.organizationId, targetType: "invitation", targetId: inv.id, metadata: { email: input.email, role: input.role } });
  return inv;
}

export async function revokeInvitation(ctx: TenantContext, id: string) {
  requirePermission(ctx, "team:manage");
  const r = await db.invitation.updateMany({ where: { id, organizationId: ctx.organizationId, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
  if (!r.count) throw notFound("Invitation");
  await audit({ action: "team.invite_revoke", actor: actorOf(ctx), organizationId: ctx.organizationId, targetType: "invitation", targetId: id });
}

async function ownersCount(organizationId: string) {
  return db.organizationMember.count({ where: { organizationId, status: "ACTIVE", role: { key: "OWNER" } } });
}

export async function changeMemberRole(ctx: TenantContext, memberId: string, roleKey: SystemRoleKey) {
  requirePermission(ctx, "team:manage");
  const m = await db.organizationMember.findFirst({ where: { id: memberId, organizationId: ctx.organizationId }, include: { role: true } });
  if (!m) throw notFound("Member");
  if (m.userId === ctx.userId) throw new AppError("FORBIDDEN", "You can't change your own role.");
  if ((m.role.key === "OWNER" || roleKey === "OWNER") && !isOwner(ctx)) throw new AppError("FORBIDDEN", "Only owners can grant or remove the owner role.");
  if (m.role.key === "OWNER" && roleKey !== "OWNER" && (await ownersCount(ctx.organizationId)) <= 1) throw new AppError("CONFLICT", "An organization must keep at least one owner.");
  const role = await db.role.findUniqueOrThrow({ where: { organizationId_key: { organizationId: ctx.organizationId, key: roleKey } } });
  await db.organizationMember.update({ where: { id: memberId }, data: { roleId: role.id } });
  await audit({ action: "team.role_change", actor: actorOf(ctx), organizationId: ctx.organizationId, targetType: "member", targetId: memberId, metadata: { from: m.role.key, to: roleKey } });
}

export async function setMemberStatus(ctx: TenantContext, memberId: string, action: "remove" | "disable" | "enable") {
  requirePermission(ctx, "team:manage");
  const m = await db.organizationMember.findFirst({ where: { id: memberId, organizationId: ctx.organizationId }, include: { role: true } });
  if (!m) throw notFound("Member");
  if (m.userId === ctx.userId) throw new AppError("FORBIDDEN", "You can't remove or disable yourself.");
  if (m.role.key === "OWNER" && !isOwner(ctx)) throw new AppError("FORBIDDEN", "Only owners can remove or disable an owner.");
  if (m.role.key === "OWNER" && action !== "enable" && (await ownersCount(ctx.organizationId)) <= 1) throw new AppError("CONFLICT", "An organization must keep at least one owner.");
  if (action === "remove") await db.organizationMember.delete({ where: { id: memberId } });
  else await db.organizationMember.update({ where: { id: memberId }, data: { status: action === "disable" ? "DISABLED" : "ACTIVE" } });
  await audit({ action: `team.member_${action}`, actor: actorOf(ctx), organizationId: ctx.organizationId, targetType: "member", targetId: memberId, metadata: { userId: m.userId } });
}

export async function updateRolePermissions(ctx: TenantContext, roleKey: SystemRoleKey, permissions: string[]) {
  requirePermission(ctx, "team:manage");
  if (roleKey === "OWNER") throw new AppError("FORBIDDEN", "The owner role always has every permission.");
  if (roleKey === "ADMIN" && !isOwner(ctx)) throw new AppError("FORBIDDEN", "Only owners can change the admin role.");
  const valid = permissions.filter((p) => (ALL_PERMISSIONS as string[]).includes(p));
  const role = await db.role.findUniqueOrThrow({ where: { organizationId_key: { organizationId: ctx.organizationId, key: roleKey } } });
  const perms = await db.permission.findMany({ where: { key: { in: valid } }, select: { id: true } });
  await db.$transaction([db.rolePermission.deleteMany({ where: { roleId: role.id } }), db.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) })]);
  await audit({ action: "team.role_permissions_update", actor: actorOf(ctx), organizationId: ctx.organizationId, targetType: "role", targetId: role.id, metadata: { role: roleKey, permissions: valid } });
}

// ─── Accepting invitations ───

export async function findInvitation(token: string) {
  const inv = await db.invitation.findUnique({ where: { tokenHash: sha256(token) }, include: { organization: { select: { id: true, name: true, deletedAt: true } }, role: { select: { name: true } } } });
  if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date() || inv.organization.deletedAt) return null;
  return inv;
}

export async function acceptInvitation(token: string, userId: string) {
  const inv = await findInvitation(token);
  if (!inv) throw new AppError("INVALID_REQUEST", "This invitation is invalid or has expired. Ask for a new one.");
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.email !== inv.email) throw new AppError("FORBIDDEN", `This invitation was sent to ${inv.email}. Sign in with that email address to accept it.`);
  await db.$transaction(async (tx) => {
    const claimed = await tx.invitation.updateMany({ where: { id: inv.id, acceptedAt: null }, data: { acceptedAt: new Date() } });
    if (!claimed.count) throw new AppError("CONFLICT", "This invitation was already used.");
    await tx.organizationMember.upsert({
      where: { organizationId_userId: { organizationId: inv.organizationId, userId } },
      create: { organizationId: inv.organizationId, userId, roleId: inv.roleId, invitedById: inv.invitedById },
      update: { roleId: inv.roleId, status: "ACTIVE" },
    });
    if (!user.emailVerifiedAt) await tx.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } }); // invite proves the email
  });
  await audit({ action: "team.join", actor: { type: "USER", userId }, organizationId: inv.organizationId, targetType: "invitation", targetId: inv.id });
  await notify({ organizationId: inv.organizationId, type: "team.changed", title: `${user.name} joined the team`, body: `${user.name} accepted the invitation as ${inv.role.name}.`, link: "/dashboard/team" });
  return inv.organizationId;
}

export const inviteSignupSchema = z
  .object({
    name: z.string().trim().min(2, "Enter your full name.").max(100),
    phone: z.string().trim().optional(),
    password: z.string(),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match." });

export async function createUserForInvitation(token: string, input: { name: string; phone: string | null; password: string }) {
  const inv = await findInvitation(token);
  if (!inv) throw new AppError("INVALID_REQUEST", "This invitation is invalid or has expired.");
  if (await db.user.findUnique({ where: { email: inv.email } })) throw new AppError("CONFLICT", "An account with this email already exists. Sign in to accept the invitation.");
  if (input.phone && (await db.user.findUnique({ where: { phone: input.phone } }))) throw new AppError("CONFLICT", "This mobile number is already registered.", { field: "phone" });
  const user = await db.user.create({ data: { email: inv.email, name: input.name, phone: input.phone, passwordHash: await hashPassword(input.password), emailVerifiedAt: new Date() } });
  await audit({ action: "auth.register", actor: { type: "USER", userId: user.id }, organizationId: inv.organizationId, metadata: { via: "invitation" } });
  return user;
}
