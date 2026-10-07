<?php

namespace App\Enums;

/** Values of the MySQL ENUM column(s) of the same name (Prisma enum CampaignStatus). */
enum CampaignStatus: string
{
    case DRAFT = 'DRAFT';
    case PENDING_REVIEW = 'PENDING_REVIEW';
    case SCHEDULED = 'SCHEDULED';
    case PROCESSING = 'PROCESSING';
    case COMPLETED = 'COMPLETED';
    case PAUSED = 'PAUSED';
    case CANCELLED = 'CANCELLED';
    case FAILED = 'FAILED';
}
