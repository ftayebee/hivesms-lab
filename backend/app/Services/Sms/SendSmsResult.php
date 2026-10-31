<?php

namespace App\Services\Sms;

/**
 * Provider answer to a send. Three kinds of failure, because retrying the wrong one sends the
 * customer's SMS twice:
 *  - retryable: the provider certainly did NOT take the message (could not connect, 429, 503) →
 *    the dispatcher retries with backoff;
 *  - unconfirmed: the request may have reached the provider but no usable answer came back
 *    (read timeout, connection dropped mid-response, other 5xx) → never retried automatically;
 *  - otherwise: definite rejection (REJECTED).
 */
final class SendSmsResult
{
    private function __construct(
        public readonly bool $ok,
        public readonly ?string $providerMessageId = null,
        public readonly bool $retryable = false,
        public readonly ?string $errorCode = null,
        public readonly ?string $errorMessage = null,
        public readonly mixed $raw = null,
        public readonly bool $unconfirmed = false,
    ) {}

    public static function accepted(string $providerMessageId, mixed $raw = null): self
    {
        return new self(true, $providerMessageId, raw: $raw);
    }

    public static function failed(bool $retryable, string $errorCode, string $errorMessage, mixed $raw = null): self
    {
        return new self(false, null, $retryable, $errorCode, $errorMessage, $raw);
    }

    /** The provider may or may not have accepted the message: do not resend. */
    public static function unconfirmed(string $errorCode, string $errorMessage, mixed $raw = null): self
    {
        return new self(false, null, false, $errorCode, $errorMessage, $raw, true);
    }
}
