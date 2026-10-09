import "server-only";
import type { z } from "zod";
import type { MemberStatus } from "@/generated/prisma/enums";
import type { SystemRoleKey } from "@/lib/auth/permissions";
import { laravel, laravelData } from "@/lib/laravel-api";
import { date } from "@/lib/laravel/convert";
import type { inviteSchema } from "./service";

/**
 * Team management through the Laravel API (LARAVEL_FEATURES `team`). Owner-only rules, the
 * last-owner guard and self-change protection are enforced by Laravel's TeamService.
 */

interface LaravelTeam {
  members: Array<{
    id: string;
    userId: string;
    status: MemberStatus;
    joinedAt: string;
    user: { id: string; name: string; email: string; lastLoginAt?: string | null; emailVerified?: boolean } | null;
    role: { id: string; key: string; name: string } | null;
  }>;
  invitations: Array<{ id: string; email: string; expiresAt: string; createdAt: string; role: { key: string; name: string } | null }>;
  roles: Array<{ id: string; key: string; name: string; description: string | null; permissions: string[] }>;
}

export async function listTeam() {
  const t = await laravelData<LaravelTeam>("app/team");
  return {
    members: t.members.map((m) => ({
      id: m.id,
      userId: m.userId,
      status: m.status,
      joinedAt: date(m.joinedAt),
      user: { id: m.user?.id ?? m.userId, name: m.user?.name ?? "", email: m.user?.email ?? "", lastLoginAt: date(m.user?.lastLoginAt) },
      role: { key: m.role?.key ?? "", name: m.role?.name ?? "" },
    })),
    invitations: t.invitations.map((i) => ({ id: i.id, email: i.email, expiresAt: date(i.expiresAt), createdAt: date(i.createdAt), role: { key: i.role?.key ?? "", name: i.role?.name ?? "" } })),
    roles: t.roles,
  };
}

export async function inviteMember(input: z.infer<typeof inviteSchema>) {
  const { data } = await laravel.post<{ id: string; email: string }>("app/team/invitations", input);
  return data;
}

export async function revokeInvitation(id: string) {
  await laravel.delete(`app/team/invitations/${encodeURIComponent(id)}`);
}

export async function changeMemberRole(memberId: string, roleKey: SystemRoleKey) {
  await laravel.put(`app/team/members/${encodeURIComponent(memberId)}/role`, { role: roleKey });
}

export async function setMemberStatus(memberId: string, action: "remove" | "disable" | "enable") {
  await laravel.post(`app/team/members/${encodeURIComponent(memberId)}/status`, { action });
}

export async function updateRolePermissions(roleKey: SystemRoleKey, permissions: string[]) {
  await laravel.put(`app/team/roles/${encodeURIComponent(roleKey)}/permissions`, { permissions });
}
