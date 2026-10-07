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
}
