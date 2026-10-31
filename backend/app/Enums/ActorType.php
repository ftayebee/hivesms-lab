<?php

namespace App\Enums;

/** Values of the MySQL ENUM column(s) of the same name (Prisma enum ActorType). */
enum ActorType: string
{
    case USER = 'USER';
    case API_KEY = 'API_KEY';
    case SYSTEM = 'SYSTEM';
    case ADMIN = 'ADMIN';
}
