<?php

namespace App\Services\Sms;

use App\Exceptions\AppException;
use App\Services\Platform\SettingsService;
use App\Services\Sms\Providers\HttpSmsProvider;
use App\Services\Sms\Providers\MockSmsProvider;
use App\Support\ErrorCode;

/**
 * Resolves the active SMS provider from admin settings with env fallbacks (port of
 * services/sms/index.ts). Register new adapters in make().
 */
class SmsProviderManager
{
    public const OPTIONS = [
        'mock' => 'Mock (local simulation, no real SMS)',
        'http' => 'Generic HTTP gateway (requires provider-specific review)',
    ];

    /** @var array<string, SmsProviderInterface> test overrides */
    private array $overrides = [];

    public function __construct(private readonly SettingsService $settings) {}

    /** The configured provider, or a specific one by key (webhooks). */
    public function provider(?string $key = null): SmsProviderInterface
    {
        $selected = $key ?? $this->settings->smsProviderSettings()['provider'];
        if (isset($this->overrides[$selected])) {
            return $this->overrides[$selected];
        }

        return $this->make($selected) ?? throw new AppException(ErrorCode::PROVIDER_NOT_CONFIGURED, "Unknown SMS provider \"{$selected}\".", null, false);
    }

    /**
     * The provider used to actually send (and poll). In production the mock provider is refused:
     * it would mark messages as sent/delivered while nothing leaves the platform, after the customer
     * was charged. Callers check this BEFORE charging or claiming messages.
     */
    public function sendingProvider(): SmsProviderInterface
    {
        $provider = $this->provider();
        if ($provider->key() === 'mock' && app()->isProduction() && ! isset($this->overrides['mock'])) {
            throw new AppException(ErrorCode::PROVIDER_NOT_CONFIGURED, 'SMS sending is temporarily unavailable. Please try again later.');
        }

        return $provider;
    }

    public function sendingAvailable(): bool
    {
        try {
            $this->sendingProvider();

            return true;
        } catch (AppException) {
            return false;
        }
    }

    public function has(string $key): bool
    {
        return isset($this->overrides[$key]) || array_key_exists($key, self::OPTIONS);
    }

    private function make(string $key): ?SmsProviderInterface
    {
        $cfg = $this->settings->smsProviderSettings();
        $webhookSecret = $this->settings->secret('sms.provider.webhookSecret', (string) config('smsflow.sms.provider_webhook_secret'));

        return match ($key) {
            'http' => new HttpSmsProvider(
                url: $cfg['url'],
                apiKey: $this->settings->secret('sms.provider.apiKey', (string) config('smsflow.sms.provider_api_key')),
                apiSecret: $this->settings->secret('sms.provider.apiSecret', (string) config('smsflow.sms.provider_api_secret')),
                webhookSecret: $webhookSecret,
                mapping: $cfg['mapping'],
                timeoutSeconds: (int) config('smsflow.sms.provider_timeout_seconds'),
            ),
            'mock' => new MockSmsProvider($webhookSecret),
            default => null,
        };
    }

    /** Tests: replace an adapter (e.g. to simulate failures). */
    public function fake(string $key, SmsProviderInterface $provider): void
    {
        $this->overrides[$key] = $provider;
    }
}
