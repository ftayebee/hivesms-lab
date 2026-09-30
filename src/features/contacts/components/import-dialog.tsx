"use client";

import { useActionState, useState } from "react";
import { FileUp, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { Alert } from "@/components/ui/misc";
import { FormStatus, fieldError } from "@/components/shared/form-status";
import { formatNumber } from "@/lib/format";
import { importContactsAction } from "../actions";

const SAMPLE = "phone,name,email,company,tags,consent,city\n01712345678,Rahima Khatun,rahima@example.com,Example Traders,\"vip,dhaka\",opted_in,Dhaka\n";

export function ImportDialog({ groups }: { groups: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(importContactsAction, null);
  const result = state?.ok ? state.data : undefined;
  const sampleHref = `data:text/csv;charset=utf-8,${encodeURIComponent(SAMPLE)}`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <FileUp /> Import CSV
        </Button>
      </DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Import contacts</DialogTitle>
          <DialogDescription>Upload a CSV with a phone column. Name, email, company, tags and consent are optional; any other column becomes a custom field.</DialogDescription>
        </DialogHeader>
        {result ? (
          <>
            <DialogBody className="space-y-4">
              <Alert tone={result.invalid.length ? "warning" : "success"} title="Import finished">
                {formatNumber(result.created)} created, {formatNumber(result.updated)} updated, {formatNumber(result.duplicates)} duplicate rows skipped, {formatNumber(result.invalid.length)} invalid.
                {result.suppressed > 0 && ` ${formatNumber(result.suppressed)} opted-out numbers were added to your suppression list.`}
              </Alert>
              {result.invalid.length > 0 && (
                <div className="max-h-56 overflow-y-auto rounded-md border border-border">
                  <table className="w-full text-sm">
                    <caption className="sr-only">Rows that could not be imported</caption>
                    <thead className="sticky top-0 bg-surface">
                      <tr>
                        <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Row</th>
                        <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Value</th>
                        <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Problem</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {result.invalid.map((r) => (
                        <tr key={r.row}>
                          <td className="px-3 py-1.5 tabular">{r.row}</td>
                          <td className="px-3 py-1.5 font-mono text-xs">{r.value || "(empty)"}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{r.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </DialogBody>
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form action={action} noValidate>
            <DialogBody className="space-y-4">
              <FormStatus state={state} />
              <Field label="CSV file" required hint="Up to 10 MB and 100,000 rows. Excel: File → Save As → CSV UTF-8." error={fieldError(state, "file")}>
                <Input name="file" type="file" accept=".csv,text/csv" required className="h-auto py-1.5" />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Add to group" optional>
                  <NativeSelect name="groupId" defaultValue="">
                    <option value="">No group</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Consent for rows without a consent column" required>
                  <NativeSelect name="defaultConsent" defaultValue="UNKNOWN">
                    <option value="UNKNOWN">Unknown</option>
                    <option value="OPTED_IN">Opted in</option>
                    <option value="OPTED_OUT">Opted out</option>
                  </NativeSelect>
                </Field>
              </div>
              <Field label="Consent source" optional hint="e.g. Store sign-up sheet, March 2026">
                <Input name="consentSource" maxLength={120} />
              </Field>
              <a href={sampleHref} download="contacts-sample.csv" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
                <Download className="size-4" aria-hidden /> Download a sample CSV
              </a>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" loading={pending} loadingText="Importing...">
                Import
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
