<?php

namespace App\Enums;

/** Values of the MySQL ENUM column(s) of the same name (Prisma enum TicketPriority). */
enum TicketPriority: string
{
    case LOW = 'LOW';
    case NORMAL = 'NORMAL';
    case HIGH = 'HIGH';
    case URGENT = 'URGENT';
}
