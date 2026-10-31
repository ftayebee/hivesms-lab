<?php

namespace App\Services\Payment;

/**
 * Payment gateway contract (port of services/payments/types.ts). The top-up flow depends only on
 * this; adding bKash/Nagad/cards means one adapter registered in PaymentProviderManager.
 */
interface PaymentProviderInterface
{
    public function key(): string;

    public function displayName(): string;

    public function description(): string;

    /** False until tested end-to-end against the provider's sandbox. */
    public function verified(): bool;

    /**
     * @param  array{paymentId: string, total: string, currency: string, description: string, customer: array{name: string, email: string, phone: ?string, organization: string}, successUrl: string, failUrl: string, cancelUrl: string, callbackUrl: string}  $req
     * @return array{type: 'redirect', url: string, providerRef?: ?string}|array{type: 'manual', instructions: string}
     */
    public function createCheckout(array $req): array;

    /**
     * Verifies a browser return / IPN with the gateway. Null when callbacks are not supported.
     *
     * @param  array<string, mixed>  $query
     * @param  array<string, mixed>  $form
     * @return array{paymentId: string, outcome: 'succeeded'|'failed'|'cancelled', providerRef?: ?string, confirmedAmount?: ?string, reason?: ?string, raw?: mixed}|null
     */
    public function handleCallback(array $query, array $form): ?array;
}
