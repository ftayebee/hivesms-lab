<?php

namespace App\Services\Sms;

use Carbon\CarbonImmutable;

/** An SMS received from a handset (used for STOP / opt-out keywords). */
final class InboundSms
{
    public function __construct(
        public readonly string $from,
        public readonly string $to,
        public readonly string $text,
        public readonly CarbonImmutable $receivedAt,
        public readonly string $eventKey,
    ) {}
}
