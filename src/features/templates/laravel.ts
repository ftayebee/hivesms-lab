import "server-only";
import type { SmsType } from "@/generated/prisma/enums";
import { laravel, laravelData } from "@/lib/laravel-api";
import { date } from "@/lib/laravel/convert";
import type { TemplateInput } from "./service";

/** Templates through the Laravel API (LARAVEL_FEATURES `templates`); same shapes as ./service.ts. */

interface LaravelTemplate {
  id: string;
  name: string;
  body: string;
  smsType: SmsType;
  createdAt: string;
  updatedAt: string;
}

const toTemplate = (t: LaravelTemplate) => ({ id: t.id, name: t.name, body: t.body, smsType: t.smsType, createdAt: date(t.createdAt), updatedAt: date(t.updatedAt) });

export async function listTemplates(q?: string) {
  return (await laravelData<LaravelTemplate[]>("app/templates", { q })).map(toTemplate);
}

export async function saveTemplate(input: TemplateInput, id?: string) {
  const res = id ? await laravel.put<LaravelTemplate>(`app/templates/${encodeURIComponent(id)}`, input) : await laravel.post<LaravelTemplate>("app/templates", input);
  return toTemplate(res.data);
}

export async function deleteTemplate(id: string) {
  await laravel.delete(`app/templates/${encodeURIComponent(id)}`);
}
