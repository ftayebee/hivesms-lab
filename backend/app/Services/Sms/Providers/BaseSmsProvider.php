<?php

namespace App\Services\Sms\Providers;

use App\Services\Sms\SmsProviderInterface;
use App\Services\Sms\WebhookRequest;

/** Shared helpers for adapters. */
abstract class BaseSmsProvider implements SmsProviderInterface
{
    /** Common sender ID format checks (operators may be stricter). */
    public function validateSenderId(string $senderId, string $type): array
    {
        if ($type === 'MASKING') {
            if (! preg_match('/^[A-Za-z0-9 .\-&]{3,11}$/', $senderId)) {
                return ['valid' => false, 'reason' => 'Masking sender IDs are usually 3 to 11 letters, digits or spaces.'];
            }
            if (! preg_match('/[A-Za-z]/', $senderId)) {
                return ['valid' => false, 'reason' => 'A masking sender ID must contain letters.'];
            }

            return ['valid' => true];
        }

        return preg_match('/^\+?\d{6,15}$/', $senderId) ? ['valid' => true] : ['valid' => false, 'reason' => 'Non-masking sender IDs are phone numbers.'];
    }

    public function hasDeliveryReports(): bool
    {
        return true;
    }

    public function sendBulk(array $inputs): array
    {
        return array_map(fn ($i) => $this->send($i), $inputs);
    }

    public function parseInboundWebhook(WebhookRequest $request): ?array
    {
        return null;
    }
}
