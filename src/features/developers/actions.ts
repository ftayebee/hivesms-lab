"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formToObject, type ActionResult } from "@/lib/action-result";
import { tenantAction } from "@/lib/tenant-action";
import { apiKeySchema, createApiKey, createWebhook, deleteWebhook, revokeApiKey, sendTestWebhook, toggleWebhook, webhookSchema } from "./service";

export async function createApiKeyAction(_prev: unknown, formData: FormData): Promise<ActionResult<{ fullKey: string; name: string }>> {
  const raw = formToObject(formData);
  return tenantAction<{ fullKey: string; name: string }>(
    "api_keys:manage",
    async (ctx) => {
      const { key, fullKey } = await createApiKey(ctx, apiKeySchema.parse(raw));
      revalidatePath("/dashboard/api");
      return { ok: true, data: { fullKey, name: key.name } };
    },
    { raw },
  );
}

export async function revokeApiKeyAction(id: string): Promise<ActionResult> {
  return tenantAction("api_keys:manage", async (ctx) => {
    await revokeApiKey(ctx, z.uuid().parse(id));
    revalidatePath("/dashboard/api");
    return { ok: true, message: "Key revoked. Requests using it are rejected from now on." };
  });
}

export async function createWebhookAction(_prev: unknown, formData: FormData): Promise<ActionResult<{ secret: string }>> {
  const raw = formToObject(formData);
  return tenantAction<{ secret: string }>(
    "api_keys:manage",
    async (ctx) => {
      const { secret } = await createWebhook(ctx, webhookSchema.parse(raw));
      revalidatePath("/dashboard/api/webhooks");
      return { ok: true, data: { secret } };
    },
    { raw },
  );
}

export async function webhookOpAction(id: string, op: "enable" | "disable" | "delete" | "test"): Promise<ActionResult> {
  return tenantAction("api_keys:manage", async (ctx) => {
    const wid = z.uuid().parse(id);
    if (op === "delete") await deleteWebhook(ctx, wid);
    else if (op === "test") await sendTestWebhook(ctx, wid);
    else await toggleWebhook(ctx, wid, op === "enable");
    revalidatePath("/dashboard/api/webhooks");
    return { ok: true, message: op === "test" ? "Test event queued. It is delivered within a few seconds." : op === "delete" ? "Endpoint deleted." : op === "enable" ? "Endpoint enabled." : "Endpoint disabled." };
  });
}
