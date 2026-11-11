<?php

namespace App\Enums;

/** Values of the MySQL ENUM column(s) of the same name (Prisma enum MessageStatus). */
enum MessageStatus: string
{
    case QUEUED = 'QUEUED';
    case SUBMITTED = 'SUBMITTED';
    case DELIVERED = 'DELIVERED';
    case FAILED = 'FAILED';
    case REJECTED = 'REJECTED';
    case EXPIRED = 'EXPIRED';
    case CANCELLED = 'CANCELLED';
    /** The provider may or may not have taken the message: kept charged, never resent, reviewed by staff. */
    case UNKNOWN = 'UNKNOWN';
}
