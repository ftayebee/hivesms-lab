<?php

namespace App\Enums;

/** Values of the MySQL ENUM column(s) of the same name (Prisma enum PaymentStatus). */
enum PaymentStatus: string
{
    case PENDING = 'PENDING';
    case AWAITING_VERIFICATION = 'AWAITING_VERIFICATION';
    case SUCCEEDED = 'SUCCEEDED';
    case FAILED = 'FAILED';
    case CANCELLED = 'CANCELLED';
    case REFUNDED = 'REFUNDED';
}
