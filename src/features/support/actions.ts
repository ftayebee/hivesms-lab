"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formToObject, type ActionResult } from "@/lib/action-result";
import { tenantAction } from "@/lib/tenant-action";
import { closeTicket, createTicket, replySchema, replyToTicket, ticketSchema } from "./service";

export async function createTicketAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const raw = formToObject(formData);
  let id = "";
  const r = await tenantAction(
    "support:write",
    async (ctx) => {
      id = (await createTicket(ctx, ticketSchema.parse(raw))).id;
    },
    { raw },
  );
  if (!r.ok) return r;
  redirect(`/dashboard/support/${id}?created=1`);
}

export async function replyTicketAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const raw = formToObject(formData);
  return tenantAction(
    "support:write",
    async (ctx) => {
      const id = z.uuid().parse(raw.id);
      await replyToTicket(ctx, id, replySchema.parse(raw).body);
      revalidatePath(`/dashboard/support/${id}`);
      return { ok: true, message: "Reply sent." };
    },
    { raw },
  );
}

export async function closeTicketAction(id: string): Promise<ActionResult> {
  return tenantAction("support:write", async (ctx) => {
    await closeTicket(ctx, z.uuid().parse(id));
    revalidatePath(`/dashboard/support/${id}`);
    revalidatePath("/dashboard/support");
    return { ok: true, message: "Ticket closed." };
  });
}
