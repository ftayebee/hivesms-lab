<?php

namespace App\Enums;

/** Values of the MySQL ENUM column(s) of the same name (Prisma enum InvoiceStatus). */
enum InvoiceStatus: string
{
    case ISSUED = 'ISSUED';
    case PAID = 'PAID';
    case VOID = 'VOID';
}
