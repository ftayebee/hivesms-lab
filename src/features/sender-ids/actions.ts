"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formToObject, type ActionResult } from "@/lib/action-result";
import { tenantAction } from "@/lib/tenant-action";
import { requestSenderId, senderIdRequestSchema, setDefaultSenderId, withdrawSenderIdRequest } from "./service";

export async function requestSenderIdAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const raw = formToObject(formData);
  delete raw.documents;
  return tenantAction(
    "sender_ids:manage",
    async (ctx) => {
      const input = senderIdRequestSchema.parse(raw);
      const files = formData.getAll("documents").filter((f): f is File => f instanceof File);
      const s = await requestSenderId(ctx, input, files);
      revalidatePath("/dashboard/sender-ids");
      return { ok: true, message: `Request for ${s.value} submitted. We'll notify you when the status changes.` };
    },
    { raw },
  );
}

export async function setDefaultSenderIdAction(id: string): Promise<ActionResult> {
  return tenantAction("sender_ids:manage", async (ctx) => {
    await setDefaultSenderId(ctx, z.uuid().parse(id));
    revalidatePath("/dashboard/sender-ids");
    return { ok: true, message: "Default sender updated." };
  });
}

export async function withdrawSenderIdAction(id: string): Promise<ActionResult> {
  return tenantAction("sender_ids:manage", async (ctx) => {
    await withdrawSenderIdRequest(ctx, z.uuid().parse(id));
    revalidatePath("/dashboard/sender-ids");
    return { ok: true, message: "Request withdrawn." };
  });
}
