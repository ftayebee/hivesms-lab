<?php

namespace App\Enums;

/** Values of the MySQL ENUM column(s) of the same name (Prisma enum SenderIdStatus). */
enum SenderIdStatus: string
{
    case PENDING = 'PENDING';
    case APPROVED = 'APPROVED';
    case REJECTED = 'REJECTED';
    case SUSPENDED = 'SUSPENDED';
}
