<?php

namespace App\Enums;

/** Values of the MySQL ENUM column(s) of the same name (Prisma enum LeadStatus). */
enum LeadStatus: string
{
    case NEW = 'NEW';
    case CONTACTED = 'CONTACTED';
    case CLOSED = 'CLOSED';
}
