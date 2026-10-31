<?php

namespace App\Enums;

/** Values of the MySQL ENUM column(s) of the same name (Prisma enum SuppressionReason). */
enum SuppressionReason: string
{
    case OPT_OUT = 'OPT_OUT';
    case MANUAL = 'MANUAL';
    case COMPLAINT = 'COMPLAINT';
    case INVALID = 'INVALID';
}
