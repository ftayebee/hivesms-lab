<?php

namespace App\Enums;

/** Values of the MySQL ENUM column(s) of the same name (Prisma enum SenderType). */
enum SenderType: string
{
    case MASKING = 'MASKING';
    case NON_MASKING = 'NON_MASKING';
}
