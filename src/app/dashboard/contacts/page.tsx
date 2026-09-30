import Link from "next/link";
import { BookUser, Download, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Pagination } from "@/components/ui/table";
import { EmptyState, PageHeader, PermissionDenied } from "@/components/shared/states";
import { tenantWithPermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/context";
import { formatNumber } from "@/lib/format";
import { contactListQuery } from "@/features/contacts/schemas";
import { allTags, CONTACTS_PAGE_SIZE, listContacts, listGroups } from "@/features/contacts/service";
import { ContactDialog } from "@/features/contacts/components/contact-dialog";
import { ContactsTable } from "@/features/contacts/components/contacts-table";
import { ImportDialog } from "@/features/contacts/components/import-dialog";

export const metadata = { title: "Contacts" };

export default async function ContactsPage({ searchParams }: PageProps<"/dashboard/contacts">) {
  const sp = await searchParams;
  const { ctx, allowed } = await tenantWithPermission("contacts:read");
  if (!allowed) return <PermissionDenied permission="contacts:read" />;
  const q = contactListQuery.parse(sp);
  const [{ rows, total }, groups, tags] = await Promise.all([listContacts(ctx, q), listGroups(ctx), allTags(ctx)]);
  const canWrite = can(ctx, "contacts:write");
  const filtered = Boolean(q.q || q.group || q.tag || q.consent);
  const exportQs = new URLSearchParams(Object.entries({ q: q.q, group: q.group, tag: q.tag, consent: q.consent }).filter(([, v]) => v) as [string, string][]).toString();
  const groupOptions = groups.map((g) => ({ id: g.id, name: g.name }));

  return (
    <>
      <PageHeader
        title="Contacts"
        description={`${formatNumber(total)} ${filtered ? "matching " : ""}contact${total === 1 ? "" : "s"}`}
        actions={
          <>
            {can(ctx, "contacts:export") && (
              <Button asChild variant="secondary">
                <a href={`/api/v1/app/contacts/export${exportQs ? `?${exportQs}` : ""}`}>
                  <Download /> Export CSV
                </a>
              </Button>
            )}
            {canWrite && <ImportDialog groups={groupOptions} />}
            {canWrite && <ContactDialog groups={groupOptions} />}
          </>
        }
      />
      <Card>
        <form method="get" className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-center" role="search" aria-label="Filter contacts">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <label htmlFor="contact-q" className="sr-only">
              Search contacts
            </label>
            <Input id="contact-q" name="q" defaultValue={q.q} placeholder="Search name, phone, email or company" className="pl-9" />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:flex">
            <label className="sr-only" htmlFor="f-group">
              Group
            </label>
            <NativeSelect id="f-group" name="group" defaultValue={q.group ?? ""} className="lg:w-44">
              <option value="">All groups</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </NativeSelect>
            <label className="sr-only" htmlFor="f-tag">
              Tag
            </label>
            <NativeSelect id="f-tag" name="tag" defaultValue={q.tag ?? ""} className="lg:w-36">
              <option value="">All tags</option>
              {tags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </NativeSelect>
            <label className="sr-only" htmlFor="f-consent">
              Consent
            </label>
            <NativeSelect id="f-consent" name="consent" defaultValue={q.consent ?? ""} className="lg:w-36">
              <option value="">Any consent</option>
              <option value="OPTED_IN">Opted in</option>
              <option value="UNKNOWN">Unknown</option>
              <option value="OPTED_OUT">Opted out</option>
            </NativeSelect>
            <label className="sr-only" htmlFor="f-sort">
              Sort
            </label>
            <NativeSelect id="f-sort" name="sort" defaultValue={q.sort} className="lg:w-32">
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="name">Name</option>
            </NativeSelect>
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="secondary">
              Apply
            </Button>
            {filtered && (
              <Button asChild variant="ghost">
                <Link href="/dashboard/contacts">Reset</Link>
              </Button>
            )}
          </div>
        </form>

        {rows.length === 0 ? (
          filtered ? (
            <EmptyState icon={Search} title="No contacts match these filters" description="Try a different search or clear the filters." action={<Button asChild variant="secondary"><Link href="/dashboard/contacts">Clear filters</Link></Button>} />
          ) : (
            <EmptyState
              icon={BookUser}
              title="No contacts yet"
              description="Add contacts one by one or import a CSV file. You can then group them for campaigns."
              action={
                canWrite ? (
                  <>
                    <ImportDialog groups={groupOptions} />
                    <ContactDialog groups={groupOptions} />
                  </>
                ) : undefined
              }
            />
          )
        ) : (
          <>
            <ContactsTable
              canWrite={canWrite}
              groups={groupOptions}
              rows={rows.map((r) => ({
                id: r.id,
                name: r.name,
                phone: r.phone,
                email: r.email,
                company: r.company,
                tags: r.tags,
                groupIds: r.groups.map((g) => g.group.id),
                groupNames: r.groups.map((g) => g.group.name),
                consentStatus: r.consentStatus,
                consentSource: r.consentSource,
                customFields: Object.fromEntries(Object.entries((r.customFields as Record<string, unknown>) ?? {}).map(([k, v]) => [k, String(v ?? "")])),
                createdAt: r.createdAt.toISOString(),
              }))}
            />
            <Pagination page={q.page} pageSize={CONTACTS_PAGE_SIZE} total={total} searchParams={sp} basePath="/dashboard/contacts" />
          </>
        )}
      </Card>
    </>
  );
}
