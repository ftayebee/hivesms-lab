<?php

namespace App\Models;

use DateTimeInterface;
use Illuminate\Database\Eloquent\Model;

/**
 * Conventions of the existing schema (created by the Prisma app), shared by every model:
 * - camelCase columns, including createdAt / updatedAt / deletedAt (set per model);
 * - UUID primary keys stored as CHAR(36) (HasUuids on the model);
 * - DATETIME(3) columns, always UTC: written with milliseconds, serialised as ISO-8601 with a
 *   trailing "Z" exactly like the Node API (e.g. "2026-10-07T09:15:00.000Z").
 */
abstract class BaseModel extends Model
{
    protected $dateFormat = 'Y-m-d H:i:s.v';

    protected function serializeDate(DateTimeInterface $date): string
    {
        return $date->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.v\Z');
    }
}
