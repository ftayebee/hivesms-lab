<?php

namespace App\Enums;

/** Values of the MySQL ENUM column(s) of the same name (Prisma enum InboundWebhookStatus). */
enum InboundWebhookStatus: string
{
    case RECEIVED = 'RECEIVED';
    case PROCESSED = 'PROCESSED';
    case IGNORED = 'IGNORED';
    case FAILED = 'FAILED';
}
