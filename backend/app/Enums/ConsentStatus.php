<?php

namespace App\Enums;

/** Values of the MySQL ENUM column(s) of the same name (Prisma enum ConsentStatus). */
enum ConsentStatus: string
{
    case OPTED_IN = 'OPTED_IN';
    case UNKNOWN = 'UNKNOWN';
    case OPTED_OUT = 'OPTED_OUT';
}
