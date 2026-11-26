"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Download, FileSpreadsheet, RotateCcw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Alert } from "@/components/ui/misc";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toaster";
import { formatBDT, formatDateTime, formatNumber } from "@/lib/format";
import { formatBdPhone } from "@/lib/phone";
import { importReportAction, previewReportImportAction } from "../actions";
import type { ImportPreview, ImportStatus } from "../types";

const STATUS_LABEL: Record<ImportStatus, string> = { DELIVERED: "Delivered", SUBMITTED: "Sent", FAILED: "Failed", REJECTED: "Rejected", EXPIRED: "Expired" };

const COLUMN_LABEL: Record<string, string> = {
  sender: "Sender ID",
  phone: "Mobile Number",
  message: "Message",
  sentAt: "Sent At",
  status: "Status",
  smsType: "SMS Type",
  deliveredAt: "Delivered At",
  error: "Error",
  reference: "Reference",
  cost: "Cost",
};

/**
 * Upload → preview (nothing written) → confirm with password → import. The same file is sent
 * again on import; changing the customer or the file clears the preview.
 */
export function ReportImportWizard({ customers, initialCustomer }: { customers: { id: string; name: string }[]; initialCustomer?: string }) {
  const router = useRouter();
  const [organizationId, setOrganizationId] = useState(initialCustomer ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [charge, setCharge] = useState(true);
  const [note, setNote] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  const reset = () => {
    setPreview(null);
    setDone(null);
    setPassword("");
    setErrors({});
  };

  const onPreview = () =>
    start(async () => {
      setErrors({});
      setDone(null);
      const fd = new FormData();
      fd.set("organizationId", organizationId);
      if (file) fd.set("file", file, file.name);
      const r = await previewReportImportAction(fd);
      if (r.ok && r.data) setPreview(r.data);
      else if (!r.ok) {
        setPreview(null);
        setErrors(r.fieldErrors ?? {});
        toast.error(r.error);
      }
    });

  const onImport = () =>
    start(async () => {
      setErrors({});
      const fd = new FormData();
      fd.set("organizationId", organizationId);
      if (file) fd.set("file", file, file.name);
      fd.set("chargeWallet", charge ? "true" : "false");
      fd.set("note", note);
      fd.set("currentPassword", password);
      const r = await importReportAction(fd);
      setPassword("");
      if (r.ok) {
        toast.success(r.message ?? "Report imported.");
        setDone(r.message ?? "Report imported.");
        setPreview(null);
        setFile(null);
        setNote("");
        if (fileInput.current) fileInput.current.value = "";
        router.refresh();
      } else {
        setErrors(r.fieldErrors ?? {});
        toast.error(r.error);
      }
    });

  const canImport = !!preview && preview.valid > 0 && !preview.alreadyImported && (!charge || preview.sufficientBalance) && password.length > 0;
  const statusEntries = preview ? (Object.entries(preview.byStatus) as [ImportStatus, number][]) : [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>1. Customer and file</CardTitle>
            <CardDescription>CSV (UTF-8) with one SMS per row. Times without a time zone are read as Asia/Dhaka.</CardDescription>
          </div>
          <Button asChild variant="secondary" size="sm">
            <a href="/api/v1/admin/report-imports/template" download>
              <Download /> Download template
            </a>
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Customer" required error={errors.organizationId}>
              <NativeSelect
                value={organizationId}
                onChange={(e) => {
                  setOrganizationId(e.target.value);
                  reset();
                }}
              >
                <option value="">Choose a customer…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Report file (.csv)" required error={errors.file} hint="Max 10 MB, 50,000 rows.">
              <Input
                ref={fileInput}
                type="file"
                accept=".csv,text/csv,.txt"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  reset();
                }}
              />
            </Field>
          </div>
          <div className="rounded-lg border border-dashed border-border bg-surface/50 p-3 text-xs text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">Required columns:</span> Sender ID, Mobile Number, Message, Sent At.{" "}
              <span className="font-medium text-foreground">Optional:</span> Status (Delivered, Sent, Failed, Rejected, Expired; default Delivered), SMS Type (Transactional or
              Promotional; default Transactional), Delivered At, Error, Reference, Cost (BDT; default is the customer&apos;s plan rate × segments).
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={onPreview} disabled={pending || !organizationId || !file}>
              <Upload /> {pending && !preview ? "Checking…" : "Check file"}
            </Button>
            {preview && (
              <Button variant="ghost" onClick={reset} disabled={pending}>
                <RotateCcw /> Start over
              </Button>
            )}
          </div>
          {done && (
            <Alert tone="success" title="Import complete">
              {done}
            </Alert>
          )}
        </CardContent>
      </Card>

      {preview && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>2. Review</CardTitle>
              <CardDescription>
                {preview.fileName} → {preview.organization.name}. Nothing has been imported yet.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {preview.alreadyImported && (
                <Alert tone="danger" title="Already imported">
                  This file was imported for this customer on {formatDateTime(preview.alreadyImported.createdAt)} ({formatNumber(preview.alreadyImported.importedCount)} messages). Importing it again is
                  blocked.
                </Alert>
              )}
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {[
                  ["Rows in file", formatNumber(preview.rowCount)],
                  ["Will import", formatNumber(preview.valid)],
                  ["Skipped", formatNumber(preview.skipped)],
                  ["Segments", formatNumber(preview.segments)],
                  ["Total cost", formatBDT(preview.totalCost)],
                  ["Wallet balance", formatBDT(preview.balance)],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-lg border border-border bg-card p-3">
                    <dt className="text-xs text-muted-foreground">{k}</dt>
                    <dd className="mt-1 text-lg font-semibold tabular">{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {statusEntries.map(([s, n]) => (
                  <StatusBadge key={s} status={s} label={`${STATUS_LABEL[s]} · ${formatNumber(n)}`} />
                ))}
                {preview.firstSentAt && (
                  <span className="text-muted-foreground">
                    Sent between {formatDateTime(preview.firstSentAt)} and {formatDateTime(preview.lastSentAt ?? preview.firstSentAt)}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Columns matched:{" "}
                {Object.entries(preview.columns)
                  .map(([k, h]) => `${COLUMN_LABEL[k] ?? k} ← “${h}”`)
                  .join(" · ")}
              </p>

              {preview.errors.length > 0 && (
                <div>
                  <h3 className="mb-2 text-sm font-medium">
                    Rows that will be skipped ({formatNumber(preview.skipped)}
                    {preview.skipped > preview.errors.length ? `, first ${preview.errors.length} shown` : ""})
                  </h3>
                  <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-3 text-sm">
                    {preview.errors.map((e) => (
                      <li key={e.line} className="flex gap-3">
                        <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">Line {e.line}</span>
                        <span>{e.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {preview.rows.length > 0 && (
                <div>
                  <h3 className="mb-2 text-sm font-medium">First {preview.rows.length} rows as they will be imported</h3>
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-sm">
                      <caption className="sr-only">Import preview</caption>
                      <thead className="bg-surface/70">
                        <tr>
                          {["Line", "Sent at", "Recipient", "Sender", "Message", "Status", "Type", "Seg.", "Cost"].map((h) => (
                            <th key={h} scope="col" className="h-9 whitespace-nowrap px-3 text-left text-xs font-medium text-muted-foreground">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {preview.rows.map((r) => (
                          <tr key={r.line}>
                            <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{r.line}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{formatDateTime(r.sentAt)}</td>
                            <td className="whitespace-nowrap px-3 py-2 font-mono text-[13px]">{formatBdPhone(r.to)}</td>
                            <td className="px-3 py-2 font-mono text-xs">
                              {r.senderValue}
                              <span className="ml-1 text-[10px] text-muted-foreground">{r.senderType === "MASKING" ? "mask" : "non-mask"}</span>
                            </td>
                            <td className="min-w-56 max-w-80 px-3 py-2">
                              <span className="line-clamp-2" title={r.body}>
                                {r.body}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <StatusBadge status={r.status} label={STATUS_LABEL[r.status]} />
                            </td>
                            <td className="px-3 py-2 text-xs">{r.smsType === "PROMOTIONAL" ? "Promo" : "Trans."}</td>
                            <td className="px-3 py-2 tabular">{r.segments}</td>
                            <td className="whitespace-nowrap px-3 py-2 tabular">{formatBDT(r.cost)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>3. Import</CardTitle>
              <CardDescription>Imported messages appear in the customer&apos;s Reports and message log with the source “Imported”. They are never sent.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
                <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={charge} onChange={(e) => setCharge(e.target.checked)} />
                <span>
                  <span className="font-medium">Charge {formatBDT(preview.totalCost)} to the customer&apos;s wallet</span>
                  <span className="block text-muted-foreground">
                    One SMS charge transaction for the whole import. Balance now {formatBDT(preview.balance)}.
                  </span>
                </span>
              </label>
              {charge && !preview.sufficientBalance && (
                <Alert tone="warning" title="Not enough balance">
                  The customer&apos;s wallet has {formatBDT(preview.balance)}; this import costs {formatBDT(preview.totalCost)}. Top up the wallet first, or import without charging.
                </Alert>
              )}
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Note" optional hint="Shown in the import history and the audit log.">
                  <Textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. November reports from the old panel" />
                </Field>
                <Field label="Your current password" required error={errors.currentPassword} hint="Required because this can charge a customer's wallet.">
                  <PasswordInput autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </Field>
              </div>
              <Button onClick={onImport} disabled={pending || !canImport}>
                {pending ? (
                  "Importing…"
                ) : (
                  <>
                    <CheckCircle2 /> Import {formatNumber(preview.valid)} messages{charge && Number(preview.totalCost) > 0 ? ` and charge ${formatBDT(preview.totalCost)}` : ""}
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </>
      )}

      {!preview && !done && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <FileSpreadsheet className="size-4" aria-hidden />
          <span>
            Tip: export from the other panel to Excel, rename the headers to match the template (or keep common names like <Badge tone="outline">Phone</Badge>{" "}
            <Badge tone="outline">SMS</Badge> <Badge tone="outline">Date</Badge>), then save as CSV UTF-8.
          </span>
        </div>
      )}
    </div>
  );
}
