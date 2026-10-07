<?php

namespace App\Enums;

/** Values of the MySQL ENUM column(s) of the same name (Prisma enum SmsEncoding). */
enum SmsEncoding: string
{
    case GSM7 = 'GSM7';
    case UCS2 = 'UCS2';
}
