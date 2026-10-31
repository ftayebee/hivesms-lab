<?php

namespace App\Enums;

/** Values of the MySQL ENUM column(s) of the same name (Prisma enum SmsType). */
enum SmsType: string
{
    case TRANSACTIONAL = 'TRANSACTIONAL';
    case PROMOTIONAL = 'PROMOTIONAL';
}
