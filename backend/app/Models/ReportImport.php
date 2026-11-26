<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Table `report_imports`: one CSV of SMS delivery reports imported by staff into a customer's message log. */
class ReportImport extends BaseModel
{
    use HasUuids;

    protected $table = 'report_imports';

    const CREATED_AT = 'createdAt';

    const UPDATED_AT = 'updatedAt';

    protected $fillable = [];

    protected function casts(): array
    {
        return [
            'rowCount' => 'integer',
            'importedCount' => 'integer',
            'skippedCount' => 'integer',
            'segments' => 'integer',
            'totalCost' => 'decimal:4',
            'charged' => 'boolean',
            'firstSentAt' => 'datetime',
            'lastSentAt' => 'datetime',
            'createdAt' => 'datetime',
            'updatedAt' => 'datetime',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class, 'organizationId');
    }

    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'createdById');
    }
}
