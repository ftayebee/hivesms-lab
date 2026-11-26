<?php

namespace App\Enums;

/** Values of the MySQL ENUM column(s) of the same name (Prisma enum MessageSource). */
enum MessageSource: string
{
    case API = 'API';
    case CAMPAIGN = 'CAMPAIGN';
    case DASHBOARD = 'DASHBOARD';
    case SYSTEM = 'SYSTEM';
    /** Imported by staff from an external delivery report (docs/24); never sent by this platform. */
    case IMPORT = 'IMPORT';
}
