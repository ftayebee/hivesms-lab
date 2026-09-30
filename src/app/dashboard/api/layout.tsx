import { SubNav } from "@/components/shared/sub-nav";

export default function ApiLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SubNav
        label="API sections"
        items={[
          { href: "/dashboard/api", label: "API keys", exact: true },
          { href: "/dashboard/api/logs", label: "Request logs" },
          { href: "/dashboard/api/webhooks", label: "Webhooks" },
        ]}
      />
      {children}
    </>
  );
}
