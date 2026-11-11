<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;

/** Table `campaign_uploads`: a dynamic SMS CSV stored privately for one organization. */
class CampaignUpload extends BaseModel
{
    use HasUuids;

    protected $table = 'campaign_uploads';

    const CREATED_AT = 'createdAt';

    const UPDATED_AT = 'updatedAt';

    protected $fillable = [];

    protected $attributes = ['status' => 'READY'];

    protected function casts(): array
    {
        return [
            'headers' => 'array',
            'rowCount' => 'integer',
            'sizeBytes' => 'integer',
            'expiresAt' => 'datetime',
            'createdAt' => 'datetime',
            'updatedAt' => 'datetime',
        ];
    }
}
