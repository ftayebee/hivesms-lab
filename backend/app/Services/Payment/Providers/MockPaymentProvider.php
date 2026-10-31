<?php

namespace App\Services\Payment\Providers;

use App\Services\Payment\PaymentProviderInterface;

/**
 * Development-only simulated checkout: redirects to the app's test page where the developer
 * chooses success or failure (POST /api/v1/app/payments/{id}/mock-complete). Disabled in production
 * unless ALLOW_MOCK_PAYMENTS=true (staging only).
 */
class MockPaymentProvider implements PaymentProviderInterface
{
    public function key(): string
    {
        return 'mock';
    }

    public function displayName(): string
    {
        return 'Test payment (simulation)';
    }

    public function description(): string
    {
        return 'Simulated checkout for development. No money is charged.';
    }

    public function verified(): bool
    {
        return true;
    }

    public function createCheckout(array $req): array
    {
        // Relative: the Next.js app performs the redirect (same value as the Node implementation).
        return ['type' => 'redirect', 'url' => "/dashboard/wallet/mock-checkout/{$req['paymentId']}"];
    }

    public function handleCallback(array $query, array $form): ?array
    {
        return null;
    }
}
