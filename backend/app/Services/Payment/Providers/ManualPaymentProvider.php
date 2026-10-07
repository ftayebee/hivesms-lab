<?php

namespace App\Services\Payment\Providers;

use App\Services\Payment\PaymentProviderInterface;

/**
 * Bank transfer / any off-platform method: the customer pays outside the platform and submits a
 * reference; an admin verifies it (Admin → Payments), which credits the wallet.
 */
class ManualPaymentProvider implements PaymentProviderInterface
{
    public function __construct(private readonly string $instructions) {}

    public function key(): string
    {
        return 'manual';
    }

    public function displayName(): string
    {
        return 'Bank transfer / manual payment';
    }

    public function description(): string
    {
        return 'Pay offline, submit your transaction reference, and we verify it.';
    }

    public function verified(): bool
    {
        return true;
    }

    public function createCheckout(array $req): array
    {
        return ['type' => 'manual', 'instructions' => $this->instructions];
    }

    public function handleCallback(array $query, array $form): ?array
    {
        return null;
    }
}
