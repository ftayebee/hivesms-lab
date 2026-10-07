<?php

namespace App\Enums;

/** Values of the MySQL ENUM column(s) of the same name (Prisma enum MessageSource). */
enum MessageSource: string
{
    case API = 'API';
    case CAMPAIGN = 'CAMPAIGN';
    case DASHBOARD = 'DASHBOARD';
    case SYSTEM = 'SYSTEM';
}
