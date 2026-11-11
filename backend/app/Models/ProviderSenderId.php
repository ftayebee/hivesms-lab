<?php

namespace App\Models;

use App\Enums\SenderType;
use Illuminate\Database\Eloquent\Concerns\HasUuids;

/** Table `provider_sender_ids`: sender IDs available on the upstream SMS provider account. */
class ProviderSenderId extends BaseModel
{
    use HasUuids;

    protected $table = 'provider_sender_ids';

    const CREATED_AT = 'createdAt';

    const UPDATED_AT = 'updatedAt';

    protected $fillable = [];

    protected $attributes = ['source' => 'MANUAL', 'active' => true];

    protected function casts(): array
    {
        return [
            'type' => SenderType::class,
            'active' => 'boolean',
            'lastSyncedAt' => 'datetime',
            'createdAt' => 'datetime',
            'updatedAt' => 'datetime',
        ];
    }
}
