<?php

namespace App\Services\Sms;

/** One message handed to a provider adapter (port of SendSmsInput in services/sms/types.ts). */
final class SendSmsInput
{
    public function __construct(
        /** Our message id; passed through as the provider's client reference when supported. */
        public readonly string $reference,
        /** E.164, e.g. +8801712345678 */
        public readonly string $to,
        public readonly string $message,
        public readonly string $senderId,
        public readonly string $senderType,
        public readonly string $smsType,
        public readonly string $encoding,
    ) {}
}
