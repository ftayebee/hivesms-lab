"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { AlertTriangle, CalendarClock, CheckCircle2, FileUp, Megaphone, Send, Users, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Label } from "@/components/ui/field";
import { DatePicker, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/menu";
import { Alert } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SegmentMeter } from "@/components/dashboard/segment-meter";
import { calculateSegments, renderTemplate, type SegmentationRules } from "@/lib/sms-segments";
import { parseRecipientList, normalizeBdPhone } from "@/lib/phone";
import { messageCost, rateFor, type PlanRates } from "@/lib/pricing";
import { dateToDhakaLocalInput, formatBDT, formatDateTime, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toaster";
import { estimateAction, saveDraftAction, submitAction } from "@/features/campaigns/actions";
import type { CampaignEstimate } from "@/features/campaigns/service";

export interface ComposerSender {
  value: string;
  type: "MASKING" | "NON_MASKING";
  isDefault: boolean;
  label: string;
}

export interface ComposerProps {
  senders: ComposerSender[];
  groups: { id: string; name: string; count: number }[];
  templates: { id: string; name: string; body: string; smsType: "TRANSACTIONAL" | "PROMOTIONAL" }[];
  rules: SegmentationRules;
  rates: PlanRates;
  balance: number;
  quietHours: { start: number; end: number } | null;
  optOutHint: string;
  initial?: {
    id?: string;
    name?: string;
    smsType?: "TRANSACTIONAL" | "PROMOTIONAL";
    senderId?: string;
    templateId?: string;
    message?: string;
    groupIds?: string[];
    numbers?: string;
    scheduledAt?: string | null;
  };
}

const VARIABLES = ["name", "company", "phone", "email"];

export function SmsComposer({ senders, groups, templates, rules, rates, balance, quietHours, optOutHint, initial }: ComposerProps) {
  const router = useRouter();
  const [id, setId] = useState(initial?.id);
  const [name, setName] = useState(initial?.name ?? "");
  const [smsType, setSmsType] = useState<"TRANSACTIONAL" | "PROMOTIONAL">(initial?.smsType ?? "TRANSACTIONAL");
  const defaultSender = senders.find((s) => s.isDefault)?.value ?? "";
  const [senderId, setSenderId] = useState(initial?.senderId ?? defaultSender);
  const [templateId, setTemplateId] = useState(initial?.templateId ?? "");
  const [message, setMessage] = useState(initial?.message ?? "");
  const [groupIds, setGroupIds] = useState<string[]>(initial?.groupIds ?? []);
  const [numbers, setNumbers] = useState(initial?.numbers ?? "");
  const [scheduleMode, setScheduleMode] = useState<"now" | "later">(initial?.scheduledAt ? "later" : "now");
  const [scheduledAt, setScheduledAt] = useState(initial?.scheduledAt ? dateToDhakaLocalInput(new Date(initial.scheduledAt)) : "");
  const [minSchedule] = useState(() => dateToDhakaLocalInput(new Date(Date.now() + 5 * 60_000)));
  const [review, setReview] = useState<CampaignEstimate | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [pendingAction, setPendingAction] = useState<"draft" | "review" | "submit" | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const sender = senders.find((s) => s.value === senderId) ?? senders.find((s) => s.isDefault) ?? senders[0];
  const parsed = useMemo(() => parseRecipientList(numbers), [numbers]);
  const groupTotal = groups.filter((g) => groupIds.includes(g.id)).reduce((a, g) => a + g.count, 0);
  const recipientsUpTo = parsed.valid.length + groupTotal;
  const seg = useMemo(() => calculateSegments(message, rules), [message, rules]);
  const rate = rateFor(rates, smsType, sender?.type ?? "NON_MASKING");
  const credits = seg.segments * recipientsUpTo;
  const cost = messageCost(seg.segments, recipientsUpTo, rate);
  const nowQuiet = useMemo(() => {
    if (!quietHours || smsType !== "PROMOTIONAL") return false;
    const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
    return quietHours.start > quietHours.end ? h >= quietHours.start || h < quietHours.end : h >= quietHours.start && h < quietHours.end;
  }, [quietHours, smsType]);

  const previewText = renderTemplate(message, { name: "Rahim", company: "Your Company", phone: "+8801XXXXXXXXX", email: "rahim@example.com" });

  function formData() {
    const fd = new FormData();
    if (id) fd.set("id", id);
    fd.set("name", name);
    fd.set("smsType", smsType);
    fd.set("senderId", senderId);
    if (templateId) fd.set("templateId", templateId);
    fd.set("message", message);
    groupIds.forEach((g) => fd.append("groupIds", g));
    fd.set("numbers", numbers);
    fd.set("scheduleMode", scheduleMode);
    fd.set("scheduledAt", scheduledAt);
    return fd;
  }

  function applyErrors(r: { ok: false; error: string; fieldErrors?: Record<string, string[]> }) {
    const fe: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.fieldErrors ?? {})) fe[k] = v[0];
    setErrors(fe);
    setFormError(r.error);
    toast.error(r.error);
  }

  function run(kind: "draft" | "review" | "submit") {
    setPendingAction(kind);
    setFormError(null);
    start(async () => {
      try {
        if (kind === "draft") {
          const r = await saveDraftAction(formData());
          if (r.ok) {
            setErrors({});
            if (r.data?.id) setId(r.data.id);
            toast.success(r.message ?? "Draft saved.");
          } else applyErrors(r);
        } else if (kind === "review") {
          const r = await estimateAction(formData());
          if (r.ok && r.data) {
            setErrors({});
            setReview(r.data);
          } else if (!r.ok) applyErrors(r);
        } else {
          const r = await submitAction(formData());
          if (r.ok && r.data) {
            toast.success(r.message ?? "Done.");
            router.push(`/dashboard/campaigns/${r.data.id}`);
          } else if (!r.ok) {
            setReview(null);
            applyErrors(r);
          }
        }
      } finally {
        setPendingAction(null);
      }
    });
  }

  function insertVariable(v: string) {
    const el = textareaRef.current;
    const token = `{{${v}}}`;
    if (!el) return setMessage((m) => m + token);
    const s = el.selectionStart ?? message.length;
    const e = el.selectionEnd ?? message.length;
    const next = message.slice(0, s) + token + message.slice(e);
    setMessage(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + token.length, s + token.length);
    });
  }

  function onCsv(file: File) {
    if (file.size > 10 * 1024 * 1024) return toast.error("CSV files must be under 10 MB.");
    Papa.parse<string[]>(file, {
      skipEmptyLines: true,
      complete: (res) => {
        const rows = res.data;
        if (!rows.length) return toast.error("The file is empty.");
        const header = rows[0].map((h) => String(h).trim().toLowerCase());
        let col = header.findIndex((h) => ["phone", "mobile", "number", "msisdn", "phone_number"].includes(h));
        const hasHeader = col >= 0 || !normalizeBdPhone(rows[0][0]);
        if (col < 0) col = rows[hasHeader ? 1 : 0]?.findIndex((c) => normalizeBdPhone(c)) ?? 0;
        const found = rows.slice(hasHeader ? 1 : 0).map((r) => String(r[Math.max(0, col)] ?? "").trim()).filter(Boolean);
        setNumbers((n) => (n.trim() ? `${n.trim()}\n` : "") + found.join("\n"));
        toast.success(`Added ${formatNumber(found.length)} numbers from ${file.name}.`);
      },
      error: () => toast.error("Could not read that CSV file."),
    });
  }

  const busy = pending;
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_22rem] [&>*]:min-w-0">
      <div className="space-y-6">
        {formError && <Alert tone="danger">{formError}</Alert>}

        <Card>
          <CardHeader>
            <CardTitle>1. Campaign</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Campaign name" optional hint="Shown in reports. Generated if left empty." error={errors.name} className="sm:col-span-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="e.g. Eid offer, opted-in customers" />
            </Field>
            <fieldset className="sm:col-span-2">
              <legend className="mb-2 text-sm font-medium">Message type</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { v: "TRANSACTIONAL" as const, icon: Zap, t: "Transactional", d: "OTPs, alerts, confirmations and service notices." },
                  { v: "PROMOTIONAL" as const, icon: Megaphone, t: "Promotional", d: "Offers and marketing. Opted-out contacts are skipped." },
                ].map((o) => (
                  <label key={o.v} className={cn("flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors", smsType === o.v ? "border-primary bg-primary-soft/60" : "border-border hover:bg-muted/50")}>
                    <input type="radio" name="smsType" value={o.v} checked={smsType === o.v} onChange={() => setSmsType(o.v)} className="sr-only" />
                    <o.icon className={cn("mt-0.5 size-4 shrink-0", smsType === o.v ? "text-primary" : "text-muted-foreground")} aria-hidden />
                    <span>
                      <span className="block text-sm font-medium">{o.t}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{o.d}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2. Recipients</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {groups.length > 0 && (
              <fieldset>
                <legend className="mb-2 text-sm font-medium">Contact groups</legend>
                <div className="grid max-h-48 gap-2 overflow-y-auto rounded-md border border-border p-3 sm:grid-cols-2">
                  {groups.map((g) => (
                    <label key={g.id} className="flex items-center gap-2.5 text-sm">
                      <Checkbox checked={groupIds.includes(g.id)} onCheckedChange={(c) => setGroupIds((ids) => (c ? [...ids, g.id] : ids.filter((x) => x !== g.id)))} />
                      <span className="min-w-0 flex-1 truncate">{g.name}</span>
                      <span className="text-xs text-muted-foreground tabular">{formatNumber(g.count)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <Field
              label="Numbers"
              optional={groupIds.length > 0}
              hint="One per line, or separated by commas. Any Bangladeshi format works: 017..., 88017..., +88017..."
              error={errors.numbers}
              labelAction={
                <>
                  <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" tabIndex={-1} onChange={(e) => e.target.files?.[0] && (onCsv(e.target.files[0]), (e.target.value = ""))} aria-label="Upload CSV of numbers" />
                  <Button type="button" size="sm" variant="ghost" onClick={() => fileRef.current?.click()}>
                    <FileUp /> Upload CSV
                  </Button>
                </>
              }
            >
              <Textarea value={numbers} onChange={(e) => setNumbers(e.target.value)} rows={5} className="font-mono text-[13px]" placeholder={"01712345678\n01812345678"} />
            </Field>
            {numbers.trim() && (
              <div className="flex flex-wrap items-center gap-2 text-xs" aria-live="polite">
                <Badge tone="success">
                  <CheckCircle2 /> {formatNumber(parsed.valid.length)} valid
                </Badge>
                {parsed.invalid.length > 0 && (
                  <Badge tone="danger">
                    <X /> {formatNumber(parsed.invalid.length)} invalid
                  </Badge>
                )}
                {parsed.duplicates > 0 && <Badge tone="neutral">{formatNumber(parsed.duplicates)} duplicates removed</Badge>}
                {parsed.invalid.length > 0 && <span className="truncate text-muted-foreground">e.g. {parsed.invalid.slice(0, 3).join(", ")}</span>}
              </div>
            )}
            <p className="text-xs text-muted-foreground">Excel files: save as CSV (File → Save As → CSV UTF-8), then upload.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>3. Message</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Sender ID" required hint={sender?.type === "MASKING" ? "Brand name sender" : "Number sender"}>
              <NativeSelect value={senderId} onChange={(e) => setSenderId(e.target.value)}>
                {senders.map((s) => (
                  <option key={s.value || "default"} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Template" optional>
              <NativeSelect
                value={templateId}
                onChange={(e) => {
                  setTemplateId(e.target.value);
                  const t = templates.find((x) => x.id === e.target.value);
                  if (t) {
                    setMessage(t.body);
                    setSmsType(t.smsType);
                  }
                }}
              >
                <option value="">No template</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <div className="sm:col-span-2">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor="composer-message">
                  Message<span className="ml-0.5 text-destructive" aria-hidden>*</span>
                </Label>
                <div className="flex flex-wrap gap-1" role="group" aria-label="Insert variable">
                  {VARIABLES.map((v) => (
                    <button key={v} type="button" onClick={() => insertVariable(v)} className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground">
                      {`{{${v}}}`}
                    </button>
                  ))}
                </div>
              </div>
              <Textarea
                id="composer-message"
                ref={textareaRef}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={6}
                aria-invalid={errors.message ? true : undefined}
                aria-describedby="composer-meter"
                className="font-bangla text-[15px]"
                placeholder="Type your message. Bangla is supported."
              />
              <SegmentMeter id="composer-meter" text={message} rules={rules} className="mt-2" />
              {errors.message && (
                <p role="alert" className="mt-1 text-xs font-medium text-destructive">
                  {errors.message}
                </p>
              )}
              {smsType === "PROMOTIONAL" && !/stop/i.test(message) && (
                <p className="mt-2 text-xs text-warning">Tip: tell recipients how to opt out, e.g. &quot;{optOutHint}&quot;.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>4. Schedule</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="When to send">
              {[
                { v: "now" as const, icon: Send, t: "Send now", d: "Starts right after confirmation (or after review)." },
                { v: "later" as const, icon: CalendarClock, t: "Schedule", d: "Pick a date and time in Bangladesh time." },
              ].map((o) => (
                <label key={o.v} className={cn("flex cursor-pointer gap-3 rounded-lg border p-3", scheduleMode === o.v ? "border-primary bg-primary-soft/60" : "border-border hover:bg-muted/50")}>
                  <input type="radio" name="scheduleMode" value={o.v} checked={scheduleMode === o.v} onChange={() => setScheduleMode(o.v)} className="sr-only" />
                  <o.icon className={cn("mt-0.5 size-4 shrink-0", scheduleMode === o.v ? "text-primary" : "text-muted-foreground")} aria-hidden />
                  <span>
                    <span className="block text-sm font-medium">{o.t}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{o.d}</span>
                  </span>
                </label>
              ))}
            </div>
            {scheduleMode === "later" && (
              <Field label="Date and time (Asia/Dhaka)" required error={errors.scheduledAt} className="max-w-xs">
                <DatePicker value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} min={minSchedule} />
              </Field>
            )}
            {nowQuiet && scheduleMode === "now" && (
              <Alert tone="warning">
                Promotional messages can&apos;t be sent between {quietHours!.start}:00 and {quietHours!.end}:00 (Asia/Dhaka). Schedule this campaign for later.
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>

      <aside className="xl:sticky xl:top-20 xl:self-start">
        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg bg-surface p-3">
              <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Preview · {sender?.value || "default sender"}</p>
              <div className="rounded-lg rounded-tl-sm bg-card px-3 py-2 text-sm shadow-xs">
                <p className="whitespace-pre-wrap break-words font-bangla">{previewText || <span className="text-muted-foreground">Your message appears here.</span>}</p>
              </div>
              {/\{\{\w+\}\}/.test(message) && <p className="mt-1.5 text-[11px] text-muted-foreground">Variables shown with sample values.</p>}
            </div>
            <dl className="space-y-2 text-sm">
              {[
                ["Recipients", groupTotal ? `up to ${formatNumber(recipientsUpTo)}` : formatNumber(recipientsUpTo)],
                ["Characters", `${formatNumber(seg.units)}`],
                ["SMS segments", `${seg.segments}`],
                ["Estimated credits", `${formatNumber(credits)} SMS`],
                ["Rate per segment", formatBDT(rate.toString())],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="font-medium tabular">{v}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-3 border-t border-border pt-2">
                <dt className="font-medium">Estimated cost</dt>
                <dd className="font-semibold tabular">{formatBDT(cost.toString())}</dd>
              </div>
              <div className="flex justify-between gap-3 text-xs">
                <dt className="text-muted-foreground">Wallet balance</dt>
                <dd className={cn("tabular", cost.gt(balance) ? "font-medium text-destructive" : "text-muted-foreground")}>{formatBDT(balance)}</dd>
              </div>
            </dl>
            {groupTotal > 0 && <p className="text-xs text-muted-foreground">Group totals include contacts that may be skipped (duplicates{smsType === "PROMOTIONAL" ? ", opted out" : ""}). Review shows the exact count.</p>}
            <div className="grid gap-2">
              <Button size="lg" onClick={() => run("review")} loading={busy && pendingAction === "review"} disabled={busy || !message.trim() || recipientsUpTo === 0 || seg.exceedsMax}>
                <Users /> Review and send
              </Button>
              <Button variant="secondary" onClick={() => run("draft")} loading={busy && pendingAction === "draft"} disabled={busy}>
                Save draft
              </Button>
            </div>
          </CardContent>
        </Card>
      </aside>

      <Dialog open={review !== null} onOpenChange={(o) => !o && !busy && setReview(null)}>
        <DialogContent size="md">
          {review && (
            <>
              <DialogHeader>
                <DialogTitle>Review before sending</DialogTitle>
                <DialogDescription>Exact numbers calculated on the server. Personalised messages may vary slightly in length.</DialogDescription>
              </DialogHeader>
              <DialogBody className="space-y-4">
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    ["Will receive", formatNumber(review.included)],
                    ["Skipped", formatNumber(review.skipped)],
                    ["Segments each", `${review.segments} (${review.encoding === "GSM7" ? "GSM-7" : "Unicode"})`],
                    ["Sender", `${review.senderValue}`],
                    ["Rate", formatBDT(review.rate)],
                    ["Estimated cost", formatBDT(review.estimatedCost)],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-md bg-surface p-3">
                      <dt className="text-xs text-muted-foreground">{k}</dt>
                      <dd className="mt-0.5 font-semibold tabular">{v}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-sm">
                  {review.scheduledAt ? (
                    <>
                      Scheduled for <strong>{formatDateTime(review.scheduledAt)}</strong> (Asia/Dhaka).
                    </>
                  ) : (
                    "Sends as soon as you confirm."
                  )}{" "}
                  You are charged when sending starts; failed messages are refunded per policy.
                </p>
                {!review.sufficientBalance && (
                  <Alert tone="danger" title="Not enough balance">
                    Your balance is {formatBDT(review.balance)}. Add balance in Wallet before sending.
                  </Alert>
                )}
                {review.requiresReview && (
                  <Alert tone="warning" title="This campaign will be reviewed first">
                    <ul className="list-disc pl-4">
                      {review.reviewReasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </Alert>
                )}
                {review.skipped > 0 && (
                  <p className="flex gap-2 text-xs text-muted-foreground">
                    <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden />
                    Skipped recipients are invalid numbers, platform-blocked numbers{smsType === "PROMOTIONAL" ? ", or contacts who opted out" : ""}. They are not charged.
                  </p>
                )}
              </DialogBody>
              <DialogFooter>
                <Button variant="secondary" onClick={() => setReview(null)} disabled={busy}>
                  Back to edit
                </Button>
                <Button onClick={() => run("submit")} loading={busy && pendingAction === "submit"} disabled={!review.sufficientBalance}>
                  {review.requiresReview ? "Submit for review" : review.scheduledAt ? "Schedule campaign" : `Send to ${formatNumber(review.included)}`}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
