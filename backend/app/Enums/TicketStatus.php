<?php

namespace App\Enums;

/** Values of the MySQL ENUM column(s) of the same name (Prisma enum TicketStatus). */
enum TicketStatus: string
{
    case OPEN = 'OPEN';
    case IN_PROGRESS = 'IN_PROGRESS';
    case WAITING_FOR_CUSTOMER = 'WAITING_FOR_CUSTOMER';
    case RESOLVED = 'RESOLVED';
    case CLOSED = 'CLOSED';
}
