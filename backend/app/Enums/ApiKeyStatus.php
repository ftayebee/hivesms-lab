<?php

namespace App\Enums;

/** Values of the MySQL ENUM column(s) of the same name (Prisma enum ApiKeyStatus). */
enum ApiKeyStatus: string
{
    case ACTIVE = 'ACTIVE';
    case REVOKED = 'REVOKED';
}
