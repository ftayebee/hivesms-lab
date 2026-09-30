import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { actorOf, requirePermission, type TenantContext } from "@/lib/auth/context";

export const templateSchema = z.object({
  name: z.string().trim().min(1, "Enter a template name.").max(80),
  body: z.string().trim().min(1, "Enter the message text.").max(1600, "Templates can be at most 1,600 characters."),
  smsType: z.enum(["TRANSACTIONAL", "PROMOTIONAL"]).default("TRANSACTIONAL"),
});

export type TemplateInput = z.infer<typeof templateSchema>;

export async function listTemplates(ctx: TenantContext, q?: string) {
  requirePermission(ctx, "templates:read");
  return db.template.findMany({
    where: { organizationId: ctx.organizationId, deletedAt: null, ...(q ? { OR: [{ name: { contains: q } }, { body: { contains: q } }] } : {}) },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
}

export async function saveTemplate(ctx: TenantContext, input: TemplateInput, id?: string) {
  requirePermission(ctx, "templates:write");
  if (id) {
    const t = await db.template.findFirst({ where: { id, organizationId: ctx.organizationId, deletedAt: null } });
    if (!t) throw notFound("Template");
    const updated = await db.template.update({ where: { id }, data: input });
    await audit({ action: "template.update", actor: actorOf(ctx), organizationId: ctx.organizationId, targetType: "template", targetId: id });
    return updated;
  }
  const count = await db.template.count({ where: { organizationId: ctx.organizationId, deletedAt: null } });
  if (count >= 500) throw new AppError("VALIDATION_ERROR", "You can keep up to 500 templates.");
  const t = await db.template.create({ data: { ...input, organizationId: ctx.organizationId, createdById: ctx.userId } });
  await audit({ action: "template.create", actor: actorOf(ctx), organizationId: ctx.organizationId, targetType: "template", targetId: t.id });
  return t;
}

export async function deleteTemplate(ctx: TenantContext, id: string) {
  requirePermission(ctx, "templates:write");
  const t = await db.template.findFirst({ where: { id, organizationId: ctx.organizationId, deletedAt: null } });
  if (!t) throw notFound("Template");
  await db.template.update({ where: { id }, data: { deletedAt: new Date() } });
  await audit({ action: "template.delete", actor: actorOf(ctx), organizationId: ctx.organizationId, targetType: "template", targetId: id });
}
