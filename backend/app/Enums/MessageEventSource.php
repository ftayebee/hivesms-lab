<?php

namespace App\Enums;

/** Values of the MySQL ENUM column(s) of the same name (Prisma enum MessageEventSource). */
enum MessageEventSource: string
{
    case SYSTEM = 'SYSTEM';
    case PROVIDER_WEBHOOK = 'PROVIDER_WEBHOOK';
    case PROVIDER_POLL = 'PROVIDER_POLL';
    case PROVIDER_RESPONSE = 'PROVIDER_RESPONSE';
}
