"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, Download, FileUp, Megaphone, Send, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Label } from "@/components/ui/field";
import { DatePicker, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SegmentMeter } from "@/components/dashboard/segment-meter";
import { toast } from "@/components/ui/toaster";
import type { SegmentationRules } from "@/lib/sms-segments";
import { dateToDhakaLocalInput, formatBDT, formatDateTime, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { estimateDynamicAction, previewDynamicAction, submitDynamicAction, uploadDynamicCsvAction } from "../actions";
import { unknownTokens, type DynamicEstimate, type DynamicInput, type DynamicPreview, type DynamicUpload } from "../types";

export interface DynamicComposerProps {
  senders: { value: string; label: string; isDefault: boolean }[];
  /** The organization's saved templates (same list as Send SMS). */
  templates: { id: string; name: string; body: string; smsType: "TRANSACTIONAL" | "PROMOTIONAL" }[];
  rules: SegmentationRules;
  balance: number;
  batchSizes: number[];
  defaultBatchSize: number;
  maxRows: number;
}

const STATUS_LABEL: Record<string, string> = {
  INCLUDED: "Will send",
  SKIPPED_INVALID: "Skipped",
  SKIPPED_DUPLICATE: "Duplicate",
  SKIPPED_BLOCKED: "Blocked",
  SKIPPED_SUPPRESSED: "Opted out",
};

function Step({ n, title, done, children, description }: { n: number; title: string; done?: boolean; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {done ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : null}
          {n}. {title}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

export function DynamicComposer({ senders, templates, rules, balance, batchSizes, defaultBatchSize, maxRows }: DynamicComposerProps) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [upload, setUpload] = useState<DynamicUpload | null>(null);
  const [recipientColumn, setRecipientColumn] = useState("");
  const [templateId, setTemplateId] = useState("");
  const defaultSender = senders.find((s) => s.isDefault)?.value ?? senders[0]?.value ?? "";
  const [senderId, setSenderId] = useState(defaultSender);
  const [message, setMessage] = useState("");
  const [smsType, setSmsType] = useState<"TRANSACTIONAL" | "PROMOTIONAL">("TRANSACTIONAL");
  const [name, setName] = useState("");
  const [missingValues, setMissingValues] = useState<"skip" | "reject">("skip");
  const [batchSize, setBatchSize] = useState(defaultBatchSize);
  const [scheduleMode, setScheduleMode] = useState<"now" | "later">("now");
  const [scheduledAt, setScheduledAt] = useState("");
  const [minSchedule] = useState(() => dateToDhakaLocalInput(new Date(Date.now() + 5 * 60_000)));
  const [preview, setPreview] = useState<DynamicPreview | null>(null);
  const [rowIndex, setRowIndex] = useState(0);
  const [estimate, setEstimate] = useState<DynamicEstimate | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"upload" | "preview" | "estimate" | "submit" | null>(null);

  // Merge fields: every column except the recipient column.
  const fields = useMemo(() => (upload?.headers ?? []).filter((h) => h !== recipientColumn), [upload, recipientColumn]);
  const unknown = useMemo(() => unknownTokens(message, fields), [message, fields]);
  const usesExcluded = !!recipientColumn && unknown.some((u) => u.toLowerCase() === recipientColumn.toLowerCase());

  function input(extra: Partial<DynamicInput> = {}): DynamicInput {
    return {
      uploadId: upload!.id,
      recipientColumn,
      senderColumn: null,
      senderId,
      message,
      smsType,
      name,
      missingValues,
      batchSize,
      scheduleMode,
      scheduledAt,
      ...extra,
    };
  }

  function fail(r: { ok: false; error: string; fieldErrors?: Record<string, string[]> }) {
    const fe: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.fieldErrors ?? {})) fe[k] = v[0];
    setErrors(fe);
    setFormError(r.error);
    toast.error(r.error);
  }

  function onFile(file: File) {
    if (file.size > 10 * 1024 * 1024) return toast.error("CSV files must be under 10 MB.");
    setBusy("upload");
    setFormError(null);
    start(async () => {
      try {
        const fd = new FormData();
        fd.set("file", file);
        const r = await uploadDynamicCsvAction(fd);
        if (!r.ok) return fail(r);
        setErrors({});
        setUpload(r.data!);
        setRecipientColumn(r.data!.suggestedRecipientColumn ?? "");
        setPreview(null);
        setEstimate(null);
        toast.success(`${formatNumber(r.data!.rowCount)} rows read from ${r.data!.fileName}.`);
      } finally {
        setBusy(null);
      }
    });
  }

  function runPreview(offset = 0) {
    if (!upload) return;
    setBusy("preview");
    setFormError(null);
    start(async () => {
      try {
        const r = await previewDynamicAction(input({ offset, limit: 20 }));
        if (!r.ok) return fail(r);
        setErrors({});
        setPreview(r.data!);
        setRowIndex(0);
      } finally {
        setBusy(null);
      }
    });
  }

  function runEstimate() {
    setBusy("estimate");
    setFormError(null);
    start(async () => {
      try {
        const r = await estimateDynamicAction(input());
        if (!r.ok) return fail(r);
        setErrors({});
        setConfirmed(false);
        setEstimate(r.data!);
      } finally {
        setBusy(null);
      }
    });
  }

  function runSubmit() {
    setBusy("submit");
    start(async () => {
      try {
        const r = await submitDynamicAction(input({ confirmed: true }));
        if (!r.ok) {
          setEstimate(null);
          return fail(r);
        }
        toast.success(r.message ?? "Campaign queued.");
        router.push(`/dashboard/campaigns/${r.data!.id}`);
      } finally {
        setBusy(null);
      }
    });
  }

  function insertField(f: string) {
    const token = `{{${f}}}`;
    const el = textareaRef.current;
    if (!el) return setMessage((m) => m + token);
    const s = el.selectionStart ?? message.length;
    const e = el.selectionEnd ?? message.length;
    setMessage(message.slice(0, s) + token + message.slice(e));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + token.length, s + token.length);
    });
  }

  const row = preview?.rows[rowIndex];
  const canPreview = !!upload && !!recipientColumn && message.trim() !== "" && unknown.length === 0;
  const s = preview?.stats;

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_22rem] [&>*]:min-w-0">
      <div className="space-y-6">
        {formError && <Alert tone="danger">{formError}</Alert>}

        <Step n={1} title="Upload CSV" done={!!upload} description={`UTF-8 CSV with a header row, up to ${formatNumber(maxRows)} rows and 10 MB. Bangla and English are supported.`}>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" tabIndex={-1} aria-label="Upload CSV" onChange={(e) => e.target.files?.[0] && (onFile(e.target.files[0]), (e.target.value = ""))} />
            <Button type="button" onClick={() => fileRef.current?.click()} loading={pending && busy === "upload"}>
              <FileUp /> {upload ? "Upload another file" : "Choose CSV file"}
            </Button>
            <Button asChild variant="ghost">
              <a href="/api/v1/app/dynamic-sms/template" download>
                <Download /> Download template
              </a>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Excel: File → Save As → &quot;CSV UTF-8 (Comma delimited)&quot;. Empty rows are ignored.</p>
          {upload && (
            <>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge tone="neutral">{upload.fileName}</Badge>
                <Badge tone="success">{formatNumber(upload.rowCount)} rows</Badge>
                {upload.emptyRows > 0 && <Badge tone="neutral">{formatNumber(upload.emptyRows)} empty rows ignored</Badge>}
                {upload.malformedRows > 0 && <Badge tone="danger">{formatNumber(upload.malformedRows)} malformed rows</Badge>}
              </div>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-left text-xs">
                  <thead className="bg-surface">
                    <tr>
                      <th className="px-2 py-1.5 font-medium text-muted-foreground">#</th>
                      {upload.headers.map((h) => (
                        <th key={h} className="whitespace-nowrap px-2 py-1.5 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {upload.preview.map((r) => (
                      <tr key={r.line} className={r.malformed ? "bg-destructive/5" : undefined}>
                        <td className="px-2 py-1 text-muted-foreground tabular">{r.line}</td>
                        {upload.headers.map((h) => (
                          <td key={h} className="max-w-48 truncate px-2 py-1 font-bangla">
                            {r.cells[h]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">First {upload.preview.length} rows shown.</p>
            </>
          )}
        </Step>

        {upload && (
          <Step n={2} title="Map columns" done={!!recipientColumn}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Recipient phone number column" required error={errors.recipientColumn} hint="Bangladeshi mobile numbers in any format.">
                <NativeSelect value={recipientColumn} onChange={(e) => setRecipientColumn(e.target.value)}>
                  <option value="">Choose a column…</option>
                  {upload.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Sender ID" required>
                <NativeSelect value={senderId} onChange={(e) => setSenderId(e.target.value)}>
                  {senders.map((s) => (
                    <option key={s.value || "default"} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Rows with a missing value" hint="Rows are never sent with a blank in place of a value.">
                <NativeSelect value={missingValues} onChange={(e) => setMissingValues(e.target.value as "skip" | "reject")}>
                  <option value="skip">Skip those rows</option>
                  <option value="reject">Stop: don&apos;t send the campaign</option>
                </NativeSelect>
              </Field>
            </div>
          </Step>
        )}

        {upload && recipientColumn && (
          <Step n={3} title="Message">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Campaign name" optional>
                <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="e.g. November dues reminder" />
              </Field>
              <Field label="Template" optional hint={templates.length ? "Loads the text and message type; edit the {{fields}} to match your columns." : "No saved templates yet."}>
                <NativeSelect
                  value={templateId}
                  disabled={!templates.length}
                  onChange={(e) => {
                    setTemplateId(e.target.value);
                    const t = templates.find((x) => x.id === e.target.value);
                    if (t) {
                      setMessage(t.body);
                      setSmsType(t.smsType);
                      setPreview(null);
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
              <fieldset>
                <legend className="mb-2 text-sm font-medium">Message type</legend>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { v: "TRANSACTIONAL" as const, icon: Zap, t: "Transactional" },
                    { v: "PROMOTIONAL" as const, icon: Megaphone, t: "Promotional" },
                  ].map((o) => (
                    <label key={o.v} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-sm", smsType === o.v ? "border-primary bg-primary-soft/60" : "border-border hover:bg-muted/50")}>
                      <input type="radio" name="smsType" className="sr-only" checked={smsType === o.v} onChange={() => setSmsType(o.v)} />
                      <o.icon className={cn("size-4", smsType === o.v ? "text-primary" : "text-muted-foreground")} aria-hidden />
                      {o.t}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor="dynamic-message">
                  Message<span className="ml-0.5 text-destructive" aria-hidden>*</span>
                </Label>
                <div className="flex flex-wrap gap-1" role="group" aria-label="Insert field">
                  {fields.map((f) => (
                    <button key={f} type="button" onClick={() => insertField(f)} className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground">
                      {`{{${f}}}`}
                    </button>
                  ))}
                </div>
              </div>
              <Textarea
                id="dynamic-message"
                ref={textareaRef}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={6}
                className="font-bangla text-[15px]"
                aria-invalid={unknown.length > 0 || errors.message ? true : undefined}
                placeholder={fields.length ? `Dear {{${fields[0]}}}, …` : "Type your message."}
              />
              <SegmentMeter text={message} rules={rules} className="mt-2" />
              <p className="mt-1 text-xs text-muted-foreground">Segments are counted per recipient after personalisation; longer values cost more.</p>
              {unknown.length > 0 && (
                <p role="alert" className="mt-1 text-xs font-medium text-destructive">
                  {usesExcluded ? "The recipient number column cannot be used in the message." : `Unknown field: ${unknown.map((u) => `{{${u}}}`).join(", ")}. Click a field above to insert it.`}
                </p>
              )}
              {errors.message && unknown.length === 0 && (
                <p role="alert" className="mt-1 text-xs font-medium text-destructive">
                  {errors.message}
                </p>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Batch size" hint="Messages are sent in batches; you can pause between batches." error={errors.batchSize}>
                <NativeSelect value={String(batchSize)} onChange={(e) => setBatchSize(Number(e.target.value))}>
                  {batchSizes.map((b) => (
                    <option key={b} value={b}>
                      {b} messages per batch
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <fieldset>
                <legend className="mb-2 text-sm font-medium">When to send</legend>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { v: "now" as const, icon: Send, t: "Send now" },
                    { v: "later" as const, icon: CalendarClock, t: "Schedule" },
                  ].map((o) => (
                    <label key={o.v} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-sm", scheduleMode === o.v ? "border-primary bg-primary-soft/60" : "border-border hover:bg-muted/50")}>
                      <input type="radio" name="scheduleMode" className="sr-only" checked={scheduleMode === o.v} onChange={() => setScheduleMode(o.v)} />
                      <o.icon className={cn("size-4", scheduleMode === o.v ? "text-primary" : "text-muted-foreground")} aria-hidden />
                      {o.t}
                    </label>
                  ))}
                </div>
              </fieldset>
              {scheduleMode === "later" && (
                <Field label="Date and time (Asia/Dhaka)" required error={errors.scheduledAt}>
                  <DatePicker value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} min={minSchedule} />
                </Field>
              )}
            </div>
            <Button variant="secondary" onClick={() => runPreview(0)} disabled={!canPreview || pending} loading={pending && busy === "preview"}>
              Preview messages
            </Button>
          </Step>
        )}

        {preview && (
          <Step n={4} title="Preview" description="Exactly what each recipient receives, rendered on the server.">
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              {[
                ["Total rows", preview.stats.totalRows],
                ["Valid recipients", preview.stats.valid],
                ["Invalid", preview.stats.invalid],
                ["Duplicates", preview.stats.duplicates],
              ].map(([k, v]) => (
                <div key={k} className="rounded-md bg-surface p-3">
                  <p className="text-xs text-muted-foreground">{k}</p>
                  <p className="mt-0.5 font-semibold tabular">{formatNumber(Number(v))}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              {preview.stats.invalidPhone > 0 && <Badge tone="danger">{formatNumber(preview.stats.invalidPhone)} invalid numbers</Badge>}
              {preview.stats.missingValues > 0 && <Badge tone="warning">{formatNumber(preview.stats.missingValues)} missing values</Badge>}
              {preview.stats.invalidSender > 0 && <Badge tone="danger">{formatNumber(preview.stats.invalidSender)} unapproved sender IDs</Badge>}
              {preview.stats.malformed > 0 && <Badge tone="danger">{formatNumber(preview.stats.malformed)} malformed rows</Badge>}
              {preview.stats.tooLong > 0 && <Badge tone="danger">{formatNumber(preview.stats.tooLong)} too long</Badge>}
              {preview.stats.suppressed + preview.stats.blocked > 0 && <Badge tone="neutral">{formatNumber(preview.stats.suppressed + preview.stats.blocked)} opted out / blocked</Badge>}
            </div>
            {row && (
              <div className="rounded-lg border border-border p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" aria-label="Previous row" disabled={rowIndex === 0 && preview.offset === 0} onClick={() => (rowIndex > 0 ? setRowIndex(rowIndex - 1) : runPreview(Math.max(0, preview.offset - 20)))}>
                      <ChevronLeft />
                    </Button>
                    <span className="text-xs text-muted-foreground tabular">
                      Row {formatNumber(row.line)} · {formatNumber(preview.offset + rowIndex + 1)} of {formatNumber(preview.total)}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Next row"
                      disabled={preview.offset + rowIndex + 1 >= preview.total}
                      onClick={() => (rowIndex < preview.rows.length - 1 ? setRowIndex(rowIndex + 1) : runPreview(preview.offset + 20))}
                    >
                      <ChevronRight />
                    </Button>
                  </div>
                  <Badge tone={row.status === "INCLUDED" ? "success" : "danger"}>{STATUS_LABEL[row.status] ?? row.status}</Badge>
                </div>
                <dl className="grid gap-1 text-sm">
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0 text-muted-foreground">Recipient</dt>
                    <dd className="font-mono text-[13px]">{row.recipient || "—"}</dd>
                  </div>
                  {row.sender && (
                    <div className="flex gap-2">
                      <dt className="w-24 shrink-0 text-muted-foreground">Sender ID</dt>
                      <dd>{row.sender}</dd>
                    </div>
                  )}
                  {row.message ? (
                    <div className="mt-1 rounded-lg rounded-tl-sm bg-surface px-3 py-2">
                      <p className="whitespace-pre-wrap break-words font-bangla">{row.message}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {row.segments} segment{row.segments === 1 ? "" : "s"} · {row.encoding === "UCS2" ? "Unicode" : "GSM-7"} · {formatBDT(row.cost)}
                      </p>
                    </div>
                  ) : (
                    <p className="flex items-center gap-1.5 text-xs text-destructive">
                      <X className="size-3.5" aria-hidden /> {row.reason}
                    </p>
                  )}
                </dl>
              </div>
            )}
          </Step>
        )}
      </div>

      <aside className="xl:sticky xl:top-20 xl:self-start">
        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="space-y-2 text-sm">
              {[
                ["Rows", upload ? formatNumber(upload.rowCount) : "—"],
                ["Valid recipients", s ? formatNumber(s.valid) : "Preview to calculate"],
                ["Invalid recipients", s ? formatNumber(s.invalid) : "—"],
                ["Duplicates", s ? formatNumber(s.duplicates) : "—"],
                ["SMS segments", s ? formatNumber(s.segments) : "—"],
                ["Estimated credits", s ? `${formatNumber(s.segments)} SMS` : "—"],
                ["Sender ID", senderId || "Shared number"],
                ["Batch size", `${batchSize}`],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="text-right font-medium tabular">{v}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-3 border-t border-border pt-2">
                <dt className="font-medium">Estimated cost</dt>
                <dd className="font-semibold tabular">{s ? formatBDT(s.estimatedCost) : "—"}</dd>
              </div>
              <div className="flex justify-between gap-3 text-xs">
                <dt className="text-muted-foreground">Wallet balance</dt>
                <dd className={cn("tabular", s && Number(s.estimatedCost) > balance ? "font-medium text-destructive" : "text-muted-foreground")}>{formatBDT(balance)}</dd>
              </div>
            </dl>
            <Button size="lg" className="w-full" onClick={runEstimate} disabled={!preview || pending || !s?.valid} loading={pending && busy === "estimate"}>
              Review and send
            </Button>
            {!preview && upload && <p className="text-xs text-muted-foreground">Preview the messages first.</p>}
          </CardContent>
        </Card>
      </aside>

      <Dialog open={estimate !== null} onOpenChange={(o) => !o && !pending && setEstimate(null)}>
        <DialogContent size="md">
          {estimate && (
            <>
              <DialogHeader>
                <DialogTitle>Confirm dynamic campaign</DialogTitle>
                <DialogDescription>Calculated on the server from every row. Nothing is charged until sending starts.</DialogDescription>
              </DialogHeader>
              <DialogBody className="space-y-4">
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    ["Campaign", estimate.name],
                    ["Message type", estimate.messageType === "PROMOTIONAL" ? "Promotional" : "Transactional"],
                    ["Recipients", formatNumber(estimate.recipients)],
                    ["Sender ID", estimate.senderValue],
                    ["SMS segments", `${formatNumber(estimate.segments)} (max ${estimate.segmentsPerMessageMax} per SMS)`],
                    ["Batches", `${formatNumber(estimate.batches)} × ${estimate.batchSize}`],
                    ["Estimated cost", formatBDT(estimate.estimatedCost)],
                    ["Wallet balance", formatBDT(estimate.balance)],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-md bg-surface p-3">
                      <dt className="text-xs text-muted-foreground">{k}</dt>
                      <dd className="mt-0.5 break-words font-semibold tabular">{v}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-sm">
                  <span className="text-muted-foreground">Fields: </span>
                  {estimate.variables.length ? estimate.variables.map((v) => `{{${v}}}`).join(", ") : "none"}
                </p>
                {estimate.sample && (
                  <div className="rounded-lg bg-surface p-3 text-sm">
                    <p className="mb-1 text-[11px] text-muted-foreground">First message · {estimate.sample.recipient}</p>
                    <p className="whitespace-pre-wrap break-words font-bangla">{estimate.sample.message}</p>
                  </div>
                )}
                <p className="text-sm">{estimate.scheduledAt ? <>Scheduled for <strong>{formatDateTime(estimate.scheduledAt)}</strong> (Asia/Dhaka).</> : "Sending starts right after you confirm."}</p>
                {!estimate.sufficientBalance && (
                  <Alert tone="danger" title="Not enough balance">
                    Add balance in Wallet before sending.
                  </Alert>
                )}
                {estimate.requiresReview && (
                  <Alert tone="warning" title="This campaign gets a safety check first">
                    <ul className="list-disc pl-4">
                      {estimate.reviewReasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </Alert>
                )}
                {estimate.stats.totalRows > estimate.recipients && (
                  <p className="flex gap-2 text-xs text-muted-foreground">
                    <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden />
                    {estimate.stats.totalRows - estimate.recipients === 1 ? "1 row is" : `${formatNumber(estimate.stats.totalRows - estimate.recipients)} rows are`} skipped and not charged.
                  </p>
                )}
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                  I checked the preview and want to send {formatNumber(estimate.recipients)} personalised messages.
                </label>
              </DialogBody>
              <DialogFooter>
                <Button variant="secondary" onClick={() => setEstimate(null)} disabled={pending}>
                  Back to edit
                </Button>
                <Button onClick={runSubmit} loading={pending && busy === "submit"} disabled={!estimate.sufficientBalance || !confirmed}>
                  {estimate.requiresReview ? "Submit for safety check" : estimate.scheduledAt ? "Schedule campaign" : `Send to ${formatNumber(estimate.recipients)}`}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
