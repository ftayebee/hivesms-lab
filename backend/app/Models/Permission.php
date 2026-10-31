<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** Table `permissions`. */
class Permission extends BaseModel
{
    use HasFactory;
    use HasUuids;

    protected $table = 'permissions';

    public $timestamps = false;

    protected $fillable = [
        'key',
        'group',
        'description',
    ];

    protected function casts(): array
    {
        return [
        ];
    }

    public function roles(): HasMany
    {
        return $this->hasMany(RolePermission::class, 'permissionId');
    }

    public function grantedToRoles(): BelongsToMany
    {
        return $this->belongsToMany(Role::class, 'role_permissions', 'permissionId', 'roleId')->using(RolePermission::class);
    }
}
