<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** Table `roles`. */
class Role extends BaseModel
{
    use HasFactory;
    use HasUuids;

    protected $table = 'roles';

    const CREATED_AT = 'createdAt';

    const UPDATED_AT = 'updatedAt';

    protected $fillable = [
        'organizationId',
        'key',
        'name',
        'description',
        'isSystem',
    ];

    /** Application-side defaults (as the Prisma client applied them). */
    protected $attributes = [
        'isSystem' => true,
    ];

    protected function casts(): array
    {
        return [
            'isSystem' => 'boolean',
            'createdAt' => 'datetime',
            'updatedAt' => 'datetime',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class, 'organizationId');
    }

    public function permissions(): HasMany
    {
        return $this->hasMany(RolePermission::class, 'roleId');
    }

    public function members(): HasMany
    {
        return $this->hasMany(OrganizationMember::class, 'roleId');
    }

    public function invitations(): HasMany
    {
        return $this->hasMany(Invitation::class, 'roleId');
    }

    public function grantedPermissions(): BelongsToMany
    {
        return $this->belongsToMany(Permission::class, 'role_permissions', 'roleId', 'permissionId')->using(RolePermission::class);
    }
}
