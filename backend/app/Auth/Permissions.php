<?php

namespace App\Auth;

/**
 * Permission catalogue (port of src/lib/auth/permissions.ts). Organization permissions are stored
 * per role in role_permissions (editable per organization); the platform matrix is fixed in code.
 */
final class Permissions
{
    /** Organization-level permissions: key => [group, description]. */
    public const ORG = [
        'dashboard:read' => ['General', 'View the dashboard overview'],
        'campaigns:read' => ['Messaging', 'View campaigns and their reports'],
        'campaigns:write' => ['Messaging', 'Create, edit, schedule, pause and cancel campaigns'],
        'sms:send' => ['Messaging', 'Send SMS and launch campaigns'],
        'templates:read' => ['Messaging', 'View templates'],
        'templates:write' => ['Messaging', 'Create, edit and delete templates'],
        'contacts:read' => ['Contacts', 'View contacts and groups'],
        'contacts:write' => ['Contacts', 'Create, edit, import and delete contacts'],
        'contacts:export' => ['Contacts', 'Export contacts to CSV'],
        'sender_ids:read' => ['Sender IDs', 'View sender IDs'],
        'sender_ids:manage' => ['Sender IDs', 'Request sender IDs and set the default'],
        'reports:read' => ['Reports', 'View delivery reports and message logs'],
        'reports:export' => ['Reports', 'Export reports to CSV'],
        'api_keys:read' => ['Developers', 'View API keys, logs and webhooks'],
        'api_keys:manage' => ['Developers', 'Create and revoke API keys, manage webhooks'],
        'billing:read' => ['Billing', 'View wallet, transactions and invoices'],
        'billing:manage' => ['Billing', 'Purchase credits'],
        'team:read' => ['Team', 'View team members'],
        'team:manage' => ['Team', 'Invite, remove and change roles of members'],
        'support:read' => ['Support', 'View support tickets'],
        'support:write' => ['Support', 'Create and reply to support tickets'],
        'settings:manage' => ['Settings', 'Edit organization settings'],
    ];

    public const ROLE_ORDER = ['OWNER', 'ADMIN', 'MANAGER', 'DEVELOPER', 'VIEWER'];

    /** @return array<string, array{name: string, description: string, permissions: list<string>}> */
    public static function systemRoles(): array
    {
        $all = array_keys(self::ORG);

        return [
            'OWNER' => ['name' => 'Owner', 'description' => 'Full access, including billing and team. Cannot be edited.', 'permissions' => $all],
            'ADMIN' => ['name' => 'Admin', 'description' => 'Manages everything except ownership transfer.', 'permissions' => $all],
            'MANAGER' => ['name' => 'Manager', 'description' => 'Runs campaigns, contacts and templates. Can view billing.', 'permissions' => [
                'dashboard:read', 'campaigns:read', 'campaigns:write', 'sms:send', 'templates:read', 'templates:write', 'contacts:read',
                'contacts:write', 'contacts:export', 'sender_ids:read', 'sender_ids:manage', 'reports:read', 'reports:export', 'billing:read',
                'team:read', 'support:read', 'support:write',
            ]],
            'DEVELOPER' => ['name' => 'Developer', 'description' => 'Manages API keys and webhooks; reads reports.', 'permissions' => [
                'dashboard:read', 'campaigns:read', 'templates:read', 'sender_ids:read', 'reports:read', 'reports:export', 'api_keys:read',
                'api_keys:manage', 'support:read', 'support:write', 'team:read',
            ]],
            'VIEWER' => ['name' => 'Viewer', 'description' => 'Read-only access to campaigns and reports.', 'permissions' => [
                'dashboard:read', 'campaigns:read', 'templates:read', 'contacts:read', 'sender_ids:read', 'reports:read', 'team:read',
            ]],
        ];
    }

    /** Public API key scopes. */
    public const API_SCOPES = [
        'sms:send' => 'Send single and bulk SMS',
        'messages:read' => 'Read message status and history',
        'balance:read' => 'Read wallet balance',
        'sender_ids:read' => 'List sender IDs',
    ];

    /** Platform (admin panel) permissions → allowed platform roles. */
    public const PLATFORM = [
        'admin:access' => ['SUPPORT', 'ADMIN', 'SUPER_ADMIN'],
        'admin:customers:read' => ['SUPPORT', 'ADMIN', 'SUPER_ADMIN'],
        'admin:customers:manage' => ['ADMIN', 'SUPER_ADMIN'],
        'admin:messages:read' => ['SUPPORT', 'ADMIN', 'SUPER_ADMIN'],
        'admin:sender_ids:review' => ['ADMIN', 'SUPER_ADMIN'],
        'admin:campaigns:review' => ['SUPPORT', 'ADMIN', 'SUPER_ADMIN'],
        'admin:billing:read' => ['ADMIN', 'SUPER_ADMIN'],
        'admin:billing:manage' => ['ADMIN', 'SUPER_ADMIN'],
        'admin:pricing:manage' => ['SUPER_ADMIN', 'ADMIN'],
        'admin:support' => ['SUPPORT', 'ADMIN', 'SUPER_ADMIN'],
        'admin:users:manage' => ['SUPER_ADMIN'],
        'admin:settings:manage' => ['SUPER_ADMIN'],
        'admin:audit:read' => ['ADMIN', 'SUPER_ADMIN'],
        'admin:abuse:manage' => ['SUPPORT', 'ADMIN', 'SUPER_ADMIN'],
        // Super Admin panel (docs/17). Money-moving and owner-level permissions are SUPER_ADMIN only;
        // SUPPORT never receives a financial permission.
        'admin:finance:read' => ['ADMIN', 'SUPER_ADMIN'],
        'admin:reports:export' => ['ADMIN', 'SUPER_ADMIN'],
        'admin:health:read' => ['ADMIN', 'SUPER_ADMIN'],
        'admin:wallet:adjust' => ['SUPER_ADMIN'],
        'admin:payments:refund' => ['SUPER_ADMIN'],
        'admin:costs:manage' => ['SUPER_ADMIN'],
    ];

    /** @param list<string>|string $required */
    public static function has(array $granted, array|string $required): bool
    {
        foreach ((array) $required as $p) {
            if (! in_array($p, $granted, true)) {
                return false;
            }
        }

        return true;
    }

    public static function platformCan(string $role, string $permission): bool
    {
        return in_array($role, self::PLATFORM[$permission] ?? [], true);
    }

    /** @return list<string> platform permissions of a role (for the frontend to hide admin controls) */
    public static function platformPermissionsFor(string $role): array
    {
        return array_keys(array_filter(self::PLATFORM, fn ($roles) => in_array($role, $roles, true)));
    }
}
