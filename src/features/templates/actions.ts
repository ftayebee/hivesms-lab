"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formToObject, type ActionResult } from "@/lib/action-result";
import { tenantAction } from "@/lib/tenant-action";
import { deleteTemplate, saveTemplate, templateSchema } from "./service";

export async function saveTemplateAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const raw = formToObject(formData);
  return tenantAction(
    "templates:write",
    async (ctx) => {
      const id = typeof raw.id === "string" && raw.id ? raw.id : undefined;
      await saveTemplate(ctx, templateSchema.parse(raw), id);
      revalidatePath("/dashboard/templates");
      return { ok: true, message: id ? "Template saved." : "Template created." };
    },
    { raw },
  );
}

export async function deleteTemplateAction(id: string): Promise<ActionResult> {
  return tenantAction("templates:write", async (ctx) => {
    await deleteTemplate(ctx, z.uuid().parse(id));
    revalidatePath("/dashboard/templates");
    return { ok: true, message: "Template deleted." };
  });
}
