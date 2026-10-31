<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\Pivot;

/** Pivot: permissions granted to an organization role (composite key roleId + permissionId). */
class RolePermission extends Pivot
{
    use HasFactory;

    protected $table = 'role_permissions';

    /** Composite primary key: not addressable through Eloquent's find(); query by columns. */
    protected $primaryKey = null;

    public $incrementing = false;

    protected $dateFormat = 'Y-m-d H:i:s.v';

    public $timestamps = false;

    protected $fillable = [
        'roleId',
        'permissionId',
    ];

    protected function casts(): array
    {
        return [
        ];
    }

    public function role(): BelongsTo
    {
        return $this->belongsTo(Role::class, 'roleId');
    }

    public function permission(): BelongsTo
    {
        return $this->belongsTo(Permission::class, 'permissionId');
    }
}
