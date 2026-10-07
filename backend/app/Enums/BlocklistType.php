<?php

namespace App\Enums;

/** Values of the MySQL ENUM column(s) of the same name (Prisma enum BlocklistType). */
enum BlocklistType: string
{
    case NUMBER = 'NUMBER';
    case KEYWORD = 'KEYWORD';
    case URL_DOMAIN = 'URL_DOMAIN';
}
