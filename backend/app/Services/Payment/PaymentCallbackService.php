<?php

namespace App\Services\Payment;

use App\Models\InboundWebhookEvent;
use App\Models\Payment;
use App\Support\Crypto;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\Log;

/**
 * Browser returns and server-to-server IPNs (port of services/payments/callbacks.ts). The adapter
 * re-validates the result with the gateway; this applies it idempotently and records the event.
 * Failure/cancel callbacks cannot be verified with the gateway, so they never change state —
 * otherwise anyone could fail someone else's pending payment.
 */
class PaymentCallbackService
{
    public function __construct(private readonly PaymentProviderManager $providers, private readonly PaymentService $payments) {}

    /** @return array{paymentId: ?string, outcome: string} */
    public function process(string $providerKey, array $query, array $form): array
    {
        $provider = $this->providers->provider($providerKey);
        $result = $provider?->handleCallback($query, $form);
        if (! $result) {
            return ['paymentId' => null, 'outcome' => 'unsupported'];
        }
        $payment = Payment::query()->find($result['paymentId'], ['id', 'provider']);
        $eventKey = "payment:{$providerKey}:{$result['paymentId']}:{$result['outcome']}:".substr(Crypto::sha256(http_build_query($form).http_build_query($query)), 0, 16);
        try {
            InboundWebhookEvent::query()->forceCreate([
                'provider' => $providerKey, 'kind' => 'payment', 'eventKey' => $eventKey,
                'signatureValid' => $result['outcome'] === 'succeeded' ? true : null,
                'payload' => $result['raw'] ?? ['outcome' => $result['outcome']],
                'status' => $payment ? 'PROCESSED' : 'IGNORED', 'processedAt' => now(),
            ]);
        } catch (UniqueConstraintViolationException) {
            // duplicate delivery of the same callback: completion below is idempotent anyway
        }
        if (! $payment || $payment->provider !== $providerKey) {
            Log::warning('payment callback for unknown payment', ['provider' => $providerKey, 'paymentId' => $result['paymentId']]);

            return ['paymentId' => null, 'outcome' => 'unknown_payment'];
        }
        if ($result['outcome'] === 'succeeded' && ($result['confirmedAmount'] ?? null) === null) {
            // A gateway success without a server-verified amount is never credited.
            Log::error('payment callback success without a verified amount ignored', ['provider' => $providerKey, 'paymentId' => $payment->id]);

            return ['paymentId' => $payment->id, 'outcome' => 'unverified'];
        }
        if ($result['outcome'] === 'succeeded') {
            $this->payments->complete($payment->id, ['type' => 'SYSTEM'], $result['providerRef'] ?? null, $result['confirmedAmount'] ?? null, "{$providerKey} callback");
        } else {
            Log::info('unverified non-success payment callback recorded', ['provider' => $providerKey, 'paymentId' => $payment->id, 'outcome' => $result['outcome'], 'reason' => $result['reason'] ?? null]);
        }

        return ['paymentId' => $payment->id, 'outcome' => $result['outcome']];
    }
}
