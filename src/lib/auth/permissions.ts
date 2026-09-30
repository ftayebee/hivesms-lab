/**
 * Organization-level permission catalogue and default role templates.
 * Pure module: used by the seed, the server (enforcement) and the UI (hiding controls).
 * The UI hides actions a user cannot perform, but the server always re-checks.
 */
export const PERMISSIONS = {
  "dashboard:read": { group: "General", description: "View the dashboard overview" },
  "campaigns:read": { group: "Messaging", description: "View campaigns and their reports" },
  "campaigns:write": { group: "Messaging", description: "Create, edit, schedule, pause and cancel campaigns" },
  "sms:send": { group: "Messaging", description: "Send SMS and launch campaigns" },
  "templates:read": { group: "Messaging", description: "View templates" },
  "templates:write": { group: "Messaging", description: "Create, edit and delete templates" },
  "contacts:read": { group: "Contacts", description: "View contacts and groups" },
  "contacts:write": { group: "Contacts", description: "Create, edit, import and delete contacts" },
  "contacts:export": { group: "Contacts", description: "Export contacts to CSV" },
  "sender_ids:read": { group: "Sender IDs", description: "View sender IDs" },
  "sender_ids:manage": { group: "Sender IDs", description: "Request sender IDs and set the default" },
  "reports:read": { group: "Reports", description: "View delivery reports and message logs" },
  "reports:export": { group: "Reports", description: "Export reports to CSV" },
  "api_keys:read": { group: "Developers", description: "View API keys, logs and webhooks" },
  "api_keys:manage": { group: "Developers", description: "Create and revoke API keys, manage webhooks" },
  "billing:read": { group: "Billing", description: "View wallet, transactions and invoices" },
  "billing:manage": { group: "Billing", description: "Purchase credits" },
  "team:read": { group: "Team", description: "View team members" },
  "team:manage": { group: "Team", description: "Invite, remove and change roles of members" },
  "support:read": { group: "Support", description: "View support tickets" },
  "support:write": { group: "Support", description: "Create and reply to support tickets" },
  "settings:manage": { group: "Settings", description: "Edit organization settings" },
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export type SystemRoleKey = "OWNER" | "ADMIN" | "MANAGER" | "DEVELOPER" | "VIEWER";

export const SYSTEM_ROLES: Record<SystemRoleKey, { name: string; description: string; permissions: Permission[] }> = {
  OWNER: {
    name: "Owner",
    description: "Full access, including billing and team. Cannot be edited.",
    permissions: ALL_PERMISSIONS,
  },
  ADMIN: {
    name: "Admin",
    description: "Manages everything except ownership transfer.",
    permissions: ALL_PERMISSIONS,
  },
  MANAGER: {
    name: "Manager",
    description: "Runs campaigns, contacts and templates. Can view billing.",
    permissions: [
      "dashboard:read",
      "campaigns:read",
      "campaigns:write",
      "sms:send",
      "templates:read",
      "templates:write",
      "contacts:read",
      "contacts:write",
      "contacts:export",
      "sender_ids:read",
      "sender_ids:manage",
      "reports:read",
      "reports:export",
      "billing:read",
      "team:read",
      "support:read",
      "support:write",
    ],
  },
  DEVELOPER: {
    name: "Developer",
    description: "Manages API keys and webhooks; reads reports.",
    permissions: [
      "dashboard:read",
      "campaigns:read",
      "templates:read",
      "sender_ids:read",
      "reports:read",
      "reports:export",
      "api_keys:read",
      "api_keys:manage",
      "support:read",
      "support:write",
      "team:read",
    ],
  },
  VIEWER: {
    name: "Viewer",
    description: "Read-only access to campaigns and reports.",
    permissions: ["dashboard:read", "campaigns:read", "templates:read", "contacts:read", "sender_ids:read", "reports:read", "team:read"],
  },
};

export const ROLE_ORDER: SystemRoleKey[] = ["OWNER", "ADMIN", "MANAGER", "DEVELOPER", "VIEWER"];

export function hasPermission(granted: readonly string[], required: Permission | Permission[]): boolean {
  const list = Array.isArray(required) ? required : [required];
  return list.every((p) => granted.includes(p));
}

// ─── API key scopes (public REST API) ───

export const API_SCOPES = {
  "sms:send": "Send single and bulk SMS",
  "messages:read": "Read message status and history",
  "balance:read": "Read wallet balance",
  "sender_ids:read": "List sender IDs",
} as const;

export type ApiScope = keyof typeof API_SCOPES;
export const ALL_API_SCOPES = Object.keys(API_SCOPES) as ApiScope[];

// ─── Platform (admin panel) roles ───

export type PlatformRoleKey = "USER" | "SUPPORT" | "ADMIN" | "SUPER_ADMIN";

export const PLATFORM_PERMISSIONS = {
  "admin:access": ["SUPPORT", "ADMIN", "SUPER_ADMIN"],
  "admin:customers:read": ["SUPPORT", "ADMIN", "SUPER_ADMIN"],
  "admin:customers:manage": ["ADMIN", "SUPER_ADMIN"],
  "admin:messages:read": ["SUPPORT", "ADMIN", "SUPER_ADMIN"],
  "admin:sender_ids:review": ["ADMIN", "SUPER_ADMIN"],
  "admin:campaigns:review": ["SUPPORT", "ADMIN", "SUPER_ADMIN"],
  "admin:billing:read": ["ADMIN", "SUPER_ADMIN"],
  "admin:billing:manage": ["ADMIN", "SUPER_ADMIN"],
  "admin:pricing:manage": ["SUPER_ADMIN", "ADMIN"],
  "admin:support": ["SUPPORT", "ADMIN", "SUPER_ADMIN"],
  "admin:users:manage": ["SUPER_ADMIN"],
  "admin:settings:manage": ["SUPER_ADMIN"],
  "admin:audit:read": ["ADMIN", "SUPER_ADMIN"],
  "admin:abuse:manage": ["SUPPORT", "ADMIN", "SUPER_ADMIN"],
} as const satisfies Record<string, PlatformRoleKey[]>;

export type PlatformPermission = keyof typeof PLATFORM_PERMISSIONS;

export function platformCan(role: PlatformRoleKey, permission: PlatformPermission): boolean {
  return (PLATFORM_PERMISSIONS[permission] as readonly PlatformRoleKey[]).includes(role);
}
