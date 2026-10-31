<?php

namespace App\Services\Auth;

use App\Auth\Permissions;
use App\Models\Organization;
use App\Models\OrganizationMember;
use App\Models\Permission;
use App\Models\Role;
use App\Models\RolePermission;
use App\Models\Wallet;
use App\Support\Crypto;
use Illuminate\Support\Str;

/**
 * Organization provisioning: permission catalogue, the five system roles, owner membership and
 * wallet (port of src/features/organizations/provision.ts). Call inside a transaction.
 */
class OrganizationProvisioner
{
    public function ensurePermissionCatalogue(): void
    {
        foreach (Permissions::ORG as $key => [$group, $description]) {
            $p = Permission::query()->firstWhere('key', $key);
            if (! $p) {
                Permission::query()->forceCreate(['key' => $key, 'group' => $group, 'description' => $description]);
            } elseif ($p->group !== $group || $p->description !== $description) {
                $p->forceFill(['group' => $group, 'description' => $description])->save();
            }
        }
    }

    public static function slugify(string $name): string
    {
        $base = trim(preg_replace('/[^a-z0-9]+/', '-', strtolower(Str::ascii($name))) ?? '', '-');
        $base = substr($base, 0, 40);

        return ($base !== '' ? $base : 'org').'-'.Crypto::randomAlphanumeric(5);
    }

    /** @return array<string, string> role key => role id */
    public function createRoles(string $organizationId): array
    {
        $idByKey = Permission::query()->pluck('id', 'key');
        $roles = [];
        foreach (Permissions::ROLE_ORDER as $key) {
            $def = Permissions::systemRoles()[$key];
            $role = Role::query()->forceCreate([
                'organizationId' => $organizationId,
                'key' => $key,
                'name' => $def['name'],
                'description' => $def['description'],
                'isSystem' => true,
            ]);
            $rows = [];
            foreach ($def['permissions'] as $p) {
                if (isset($idByKey[$p])) {
                    $rows[] = ['roleId' => $role->id, 'permissionId' => $idByKey[$p]];
                }
            }
            RolePermission::query()->insert($rows);
            $roles[$key] = $role->id;
        }

        return $roles;
    }

    /** @return array{organization: Organization, roles: array<string, string>} */
    public function createOrganizationWithOwner(string $name, string $ownerUserId, ?string $industry = null, ?string $pricingPlanId = null): array
    {
        $org = Organization::query()->forceCreate([
            'name' => $name,
            'slug' => self::slugify($name),
            'industry' => $industry,
            'pricingPlanId' => $pricingPlanId,
        ]);
        $roles = $this->createRoles($org->id);
        OrganizationMember::query()->forceCreate([
            'organizationId' => $org->id,
            'userId' => $ownerUserId,
            'roleId' => $roles['OWNER'],
            'joinedAt' => now(),
        ]);
        Wallet::query()->forceCreate(['organizationId' => $org->id]);

        return ['organization' => $org, 'roles' => $roles];
    }
}
