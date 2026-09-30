import type { Messages } from "@/i18n";
import type { Permission } from "@/lib/auth/permissions";

export type NavIconName =
  | "LayoutDashboard"
  | "Megaphone"
  | "Send"
  | "BookUser"
  | "LayoutTemplate"
  | "BadgeCheck"
  | "BarChart3"
  | "Code2"
  | "Wallet"
  | "Receipt"
  | "Users"
  | "LifeBuoy"
  | "Settings";

export interface DashboardNavItem {
  key: keyof Messages["dashboardNav"];
  href: string;
  icon: NavIconName;
  permission?: Permission;
}

export const dashboardNav: { section?: keyof Messages["dashboardNav"]; items: DashboardNavItem[] }[] = [
  {
    items: [
      { key: "overview", href: "/dashboard", icon: "LayoutDashboard", permission: "dashboard:read" },
      { key: "campaigns", href: "/dashboard/campaigns", icon: "Megaphone", permission: "campaigns:read" },
      { key: "send", href: "/dashboard/send", icon: "Send", permission: "sms:send" },
    ],
  },
  {
    section: "audience",
    items: [
      { key: "contacts", href: "/dashboard/contacts", icon: "BookUser", permission: "contacts:read" },
      { key: "templates", href: "/dashboard/templates", icon: "LayoutTemplate", permission: "templates:read" },
      { key: "senderIds", href: "/dashboard/sender-ids", icon: "BadgeCheck", permission: "sender_ids:read" },
      { key: "reports", href: "/dashboard/reports", icon: "BarChart3", permission: "reports:read" },
    ],
  },
  {
    section: "developers",
    items: [{ key: "api", href: "/dashboard/api", icon: "Code2", permission: "api_keys:read" }],
  },
  {
    section: "billing",
    items: [
      { key: "wallet", href: "/dashboard/wallet", icon: "Wallet", permission: "billing:read" },
      { key: "transactions", href: "/dashboard/transactions", icon: "Receipt", permission: "billing:read" },
    ],
  },
  {
    section: "organization",
    items: [
      { key: "team", href: "/dashboard/team", icon: "Users", permission: "team:read" },
      { key: "support", href: "/dashboard/support", icon: "LifeBuoy", permission: "support:read" },
      { key: "settings", href: "/dashboard/settings", icon: "Settings" },
    ],
  },
];
