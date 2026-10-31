<?php

namespace App\Services\Sms;

use Carbon\CarbonImmutable;

/**
 * A delivery status from a provider (poll result or one webhook event). $status is one of
 * SUBMITTED | DELIVERED | FAILED | EXPIRED | REJECTED | UNKNOWN. $eventKey (webhooks only) is
 * stable across replays and makes processing idempotent.
 */
final class DeliveryStatus
{
    public function __construct(
        public readonly string $status,
        public readonly ?string $providerStatus = null,
        public readonly ?string $errorCode = null,
        public readonly ?string $description = null,
        public readonly ?CarbonImmutable $occurredAt = null,
        public readonly ?string $providerMessageId = null,
        public readonly ?string $eventKey = null,
        public readonly mixed $raw = null,
    ) {}

    /** Generic provider status → platform status (port of mapStatus in mock-provider.ts). */
    public static function map(string $s): string
    {
        return match (strtoupper(trim($s))) {
            'DELIVERED', 'DELIVRD' => 'DELIVERED',
            'FAILED', 'UNDELIV', 'UNDELIVERED' => 'FAILED',
            'EXPIRED' => 'EXPIRED',
            'REJECTED' => 'REJECTED',
            'SUBMITTED', 'ENROUTE', 'ACCEPTED' => 'SUBMITTED',
            default => 'UNKNOWN',
        };
    }
}
