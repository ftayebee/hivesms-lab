<?php

namespace App\Enums;

/** Values of the MySQL ENUM column(s) of the same name (Prisma enum OrganizationStatus). */
enum OrganizationStatus: string
{
    case ACTIVE = 'ACTIVE';
    case SUSPENDED = 'SUSPENDED';
}
