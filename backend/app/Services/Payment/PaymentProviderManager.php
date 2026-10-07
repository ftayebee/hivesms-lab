<?php

namespace App\Services\Payment;

use App\Services\Payment\Providers\ManualPaymentProvider;
use App\Services\Payment\Providers\MockPaymentProvider;
use App\Services\Payment\Providers\SslCommerzProvider;
use App\Services\Platform\SettingsService;

/** Enabled + configured payment providers (port of services/payments/index.ts). */
class PaymentProviderManager
{
    public const KEYS = ['mock', 'manual', 'sslcommerz'];

    public function __construct(private readonly SettingsService $settings) {}

    public static function mockAllowed(): bool
    {
        return ! app()->isProduction() || (bool) config('smsflow.features.allow_mock_payments');
    }

    public function provider(string $key): ?PaymentProviderInterface
    {
        $s = $this->settings->paymentSettings();
        if (! in_array($key, $s['enabled'], true)) {
            return null;
        }

        return match ($key) {
            'mock' => self::mockAllowed() ? new MockPaymentProvider : null,
            'manual' => new ManualPaymentProvider($s['manualInstructions']),
            'sslcommerz' => (function () use ($s) {
                $password = $this->settings->secret('payments.sslcommerz.storePassword', (string) config('smsflow.payments.sslcommerz_store_password'));

                return $s['sslcommerz']['storeId'] !== '' && $password !== '' ? new SslCommerzProvider($s['sslcommerz']['storeId'], $password, $s['sslcommerz']['live']) : null;
            })(),
            default => null,
        };
    }

    /** @return list<array{key: string, name: string, description: string, verified: bool}> */
    public function available(): array
    {
        $out = [];
        foreach ($this->settings->paymentSettings()['enabled'] as $key) {
            if ($p = $this->provider($key)) {
                $out[] = ['key' => $p->key(), 'name' => $p->displayName(), 'description' => $p->description(), 'verified' => $p->verified()];
            }
        }

        return $out;
    }
}
