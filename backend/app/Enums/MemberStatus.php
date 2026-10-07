<?php

namespace App\Enums;

/** Values of the MySQL ENUM column(s) of the same name (Prisma enum MemberStatus). */
enum MemberStatus: string
{
    case ACTIVE = 'ACTIVE';
    case DISABLED = 'DISABLED';
}
