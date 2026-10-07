<?php

namespace App\Enums;

/** Values of the MySQL ENUM column(s) of the same name (Prisma enum PlatformRole). */
enum PlatformRole: string
{
    case USER = 'USER';
    case SUPPORT = 'SUPPORT';
    case ADMIN = 'ADMIN';
    case SUPER_ADMIN = 'SUPER_ADMIN';
}
