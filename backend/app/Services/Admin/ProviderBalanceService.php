<?php

namespace App\Services\Admin;

use App\Services\Sms\SmsProviderManager;
use App\Support\Money;
use Illuminate\Support\Facades\Cache;

/**
 * The platform's own balance at the SMS gateway, and what it can still send. The gateway has no
 * price API, so rates come from Admin → Costs & margins when saved for this provider, otherwise
 * from config. Counts assume single-part messages. Cached briefly: every admin page load would
 * otherwise wait on the gateway.
 */
class ProviderBalanceService
{
    private const CACHE_SECONDS = 60;

    public function __construct(private readonly SmsProviderManager $providers, private readonly FinanceService $finance) {}

    /**
     * @return array{provider: string, available: bool, balance: ?string, currency: ?string, maskingCount: ?int, nonMaskingCount: ?int,
     *     maskingRate: ?string, nonMaskingRate: ?string, rateSource: ?string}
     */
    public function summary(): array
    {
        $provider = $this->providers->provider();

        return Cache::remember('admin:provider-balance:'.$provider->key(), self::CACHE_SECONDS, function () use ($provider) {
            $rates = $this->rates($provider->key());
            $balance = $provider->balance();
            $amount = $balance ? number_format($balance['amount'], 4, '.', '') : null;

            return [
                'provider' => $provider->key(),
                'available' => $balance !== null,
                'balance' => $amount,
                'currency' => $balance['currency'] ?? null,
                'maskingCount' => $amount !== null && $rates ? self::count($amount, $rates['masking']) : null,
                'nonMaskingCount' => $amount !== null && $rates ? self::count($amount, $rates['nonMasking']) : null,
                'maskingRate' => $rates['masking'] ?? null,
                'nonMaskingRate' => $rates['nonMasking'] ?? null,
                'rateSource' => $rates['source'] ?? null,
            ];
        });
    }

    private static function count(string $balance, string $rate): ?int
    {
        return Money::isPositive($rate) ? Money::floorInt(Money::div($balance, $rate)) : null;
    }

    /** @return array{masking: string, nonMasking: string, source: string}|null */
    private function rates(string $provider): ?array
    {
        $saved = $this->finance->providerCosts();
        if ($saved && ($saved['provider'] ?? null) === $provider) {
            return ['masking' => $saved['rates']['transactionalMasking'], 'nonMasking' => $saved['rates']['transactionalNonMasking'], 'source' => 'costs_settings'];
        }
        $configured = config("smsflow.sms.provider_rates.{$provider}");

        return $configured ? ['masking' => (string) $configured['masking'], 'nonMasking' => (string) $configured['non_masking'], 'source' => 'price_list'] : null;
    }
}
