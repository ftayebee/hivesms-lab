<?php

namespace App\Enums;

/** Values of the MySQL ENUM column(s) of the same name (Prisma enum WebhookDeliveryStatus). */
enum WebhookDeliveryStatus: string
{
    case PENDING = 'PENDING';
    case SUCCEEDED = 'SUCCEEDED';
    case FAILED = 'FAILED';
}
