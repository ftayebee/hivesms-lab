import { SubNav } from "@/components/shared/sub-nav";

export default function ContactsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SubNav
        label="Contacts sections"
        items={[
          { href: "/dashboard/contacts", label: "Contacts", exact: true },
          { href: "/dashboard/contacts/groups", label: "Groups" },
          { href: "/dashboard/contacts/suppression", label: "Opt-outs & suppression" },
        ]}
      />
      {children}
    </>
  );
}
