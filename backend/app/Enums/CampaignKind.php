<?php

namespace App\Enums;

/** campaigns.kind: STANDARD (one message for groups/numbers) or DYNAMIC (per-row CSV personalisation). */
enum CampaignKind: string
{
    case STANDARD = 'STANDARD';
    case DYNAMIC = 'DYNAMIC';
}
