<?php

namespace App\Models;

use App\Enums\SmsType;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/** Table `templates`. */
class Template extends BaseModel
{
    use HasFactory;
    use HasUuids;
    use SoftDeletes;

    protected $table = 'templates';

    const CREATED_AT = 'createdAt';

    const UPDATED_AT = 'updatedAt';

    const DELETED_AT = 'deletedAt';

    protected $fillable = [
        'organizationId',
        'name',
        'body',
        'smsType',
        'createdById',
    ];

    /** Application-side defaults (as the Prisma client applied them). */
    protected $attributes = [
        'smsType' => 'TRANSACTIONAL',
    ];

    protected function casts(): array
    {
        return [
            'smsType' => SmsType::class,
            'createdAt' => 'datetime',
            'updatedAt' => 'datetime',
            'deletedAt' => 'datetime',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class, 'organizationId');
    }

    public function campaigns(): HasMany
    {
        return $this->hasMany(Campaign::class, 'templateId');
    }
}
