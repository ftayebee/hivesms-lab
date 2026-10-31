<?php

namespace App\Models;

use App\Enums\AbuseReportStatus;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;

/** Table `abuse_reports`. */
class AbuseReport extends BaseModel
{
    use HasFactory;
    use HasUuids;

    protected $table = 'abuse_reports';

    const CREATED_AT = 'createdAt';

    const UPDATED_AT = 'updatedAt';

    protected $fillable = [
        'reporterName',
        'reporterEmail',
        'reporterPhone',
        'senderValue',
        'messageContent',
        'receivedAt',
        'description',
        'status',
        'organizationId',
        'resolutionNote',
        'handledById',
        'ipAddress',
    ];

    /** Application-side defaults (as the Prisma client applied them). */
    protected $attributes = [
        'status' => 'NEW',
    ];

    protected function casts(): array
    {
        return [
            'receivedAt' => 'datetime',
            'status' => AbuseReportStatus::class,
            'createdAt' => 'datetime',
            'updatedAt' => 'datetime',
        ];
    }
}
