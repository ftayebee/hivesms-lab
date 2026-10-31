<?php

namespace App\Enums;

/** Values of the MySQL ENUM column(s) of the same name (Prisma enum RecipientStatus). */
enum RecipientStatus: string
{
    case INCLUDED = 'INCLUDED';
    case SKIPPED_SUPPRESSED = 'SKIPPED_SUPPRESSED';
    case SKIPPED_INVALID = 'SKIPPED_INVALID';
    case SKIPPED_DUPLICATE = 'SKIPPED_DUPLICATE';
    case SKIPPED_BLOCKED = 'SKIPPED_BLOCKED';
}
