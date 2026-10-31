<?php

namespace App\Enums;

/** Values of the MySQL ENUM column(s) of the same name (Prisma enum AbuseReportStatus). */
enum AbuseReportStatus: string
{
    case NEW = 'NEW';
    case INVESTIGATING = 'INVESTIGATING';
    case ACTIONED = 'ACTIONED';
    case DISMISSED = 'DISMISSED';
}
