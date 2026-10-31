import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Input, NativeSelect } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Pagination, parsePage } from "@/components/ui/table";
import { EmptyState, PageHeader } from "@/components/shared/states";
import { requirePlatform } from "@/lib/auth/session";
import { messagesPage } from "@/features/admin/page-data";
import { laravelPage } from "@/lib/laravel-api";
import { formatBDT, formatDateTime, formatNumber } from "@/lib/format";
import { formatBdPhone } from "@/lib/phone";

export const metadata = { title: "Messages" };

const STATUSES = ["QUEUED", "SUBMITTED", "DELIVERED", "FAILED", "REJECTED", "EXPIRED", "CANCELLED"] as const;

export default async function AdminMessagesPage({ searchParams }: PageProps<"/admin/messages">) {
  const session = await requirePlatform("admin:messages:read");
  const sp = await searchParams;
  const to = typeof sp.to === "string" ? sp.to.trim() : "";
  const status = STATUSES.find((s) => s === sp.status);
  const page = parsePage(sp.page);
  const provider = typeof sp.provider === "string" && sp.provider ? sp.provider : undefined;
  const { rows, total, pageSize } = await laravelPage(() => messagesPage({ to, status, provider, page }, session.user.id));
  return (
    <>
      <PageHeader title="Messages" description={`${formatNumber(total)} messages across all customers. Searches by recipient are audited.`} />
      <Card>
        <form method="get" className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row" role="search">
          <label htmlFor="mt" className="sr-only">
            Recipient
          </label>
          <Input id="mt" name="to" defaultValue={to} placeholder="Recipient number" className="sm:w-56" inputMode="tel" />
          <label htmlFor="mp" className="sr-only">
            Provider message ID
          </label>
          <Input id="mp" name="provider" defaultValue={typeof sp.provider === "string" ? sp.provider : ""} placeholder="Provider message ID" className="sm:w-64" />
          <label htmlFor="ms" className="sr-only">
            Status
          </label>
          <NativeSelect id="ms" name="status" defaultValue={status ?? ""} className="sm:w-40">
            <option value="">Any status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.toLowerCase()}
              </option>
            ))}
          </NativeSelect>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
        {rows.length === 0 ? (
          <EmptyState icon={MessageSquare} title="No messages match" />
        ) : (
          <>
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Messages</caption>
                <thead className="bg-surface/70">
                  <tr>
                    {["Time", "Customer", "Recipient", "Sender", "Status", "Provider ID", "Cost", "Error"].map((h) => (
                      <th key={h} scope="col" className="h-10 whitespace-nowrap border-b border-border px-4 text-left text-xs font-medium text-muted-foreground">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((m) => (
                    <tr key={m.id}>
                      <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">{formatDateTime(m.createdAt)}</td>
                      <td className="px-4 py-2">
                        <Link href={`/admin/customers/${m.organization.id}`} className="hover:text-primary">
                          {m.organization.name}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">{formatBdPhone(m.to)}</td>
                      <td className="px-4 py-2 font-mono text-xs">{m.senderValue}</td>
                      <td className="px-4 py-2">
                        <StatusBadge status={m.status} />
                      </td>
                      <td className="max-w-40 truncate px-4 py-2 font-mono text-xs text-muted-foreground">{m.providerMessageId ?? "-"}</td>
                      <td className="whitespace-nowrap px-4 py-2 tabular">{formatBDT(m.cost.toString())}</td>
                      <td className="max-w-56 truncate px-4 py-2 text-muted-foreground">{m.errorMessage ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={pageSize} total={total} searchParams={sp} basePath="/admin/messages" />
          </>
        )}
      </Card>
    </>
  );
}
