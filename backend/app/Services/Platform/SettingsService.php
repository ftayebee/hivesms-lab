<?php

namespace App\Services\Platform;

use App\Models\Setting;
use App\Support\Crypto;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Runtime settings in the `settings` table layered over config defaults (port of
 * src/services/settings.ts). Values are cached per process for 30 s. Secret settings are
 * AES-256-GCM encrypted ({ciphertext}) and only readable server-side via secret(); nothing here
 * ever returns a secret to a client.
 */
class SettingsService
{
    public const SECRET_KEYS = [
        'sms.provider.apiKey',
        'sms.provider.apiSecret',
        'sms.provider.webhookSecret',
        'payments.sslcommerz.storePassword',
    ];

    private const TTL = 30;

    /** @var array<string, array{value: mixed, at: int}> */
    private array $cache = [];

    private function readRaw(string $key): mixed
    {
        $hit = $this->cache[$key] ?? null;
        if ($hit && time() - $hit['at'] < self::TTL) {
            return $hit['value'];
        }
        try {
            $row = Setting::query()->find($key);
            $value = $row && ! $row->isSecret ? $row->value : null;
        } catch (Throwable $e) {
            Log::warning('settings read failed, using defaults', ['key' => $key, 'error' => $e->getMessage()]);
            $value = null;
        }
        $this->cache[$key] = ['value' => $value, 'at' => time()];

        return $value;
    }

    public function get(string $key): mixed
    {
        return $this->readRaw($key);
    }

    public function set(string $key, mixed $value, ?string $updatedById = null): void
    {
        $row = Setting::query()->find($key) ?? new Setting(['key' => $key]);
        $row->forceFill(['value' => $value, 'isSecret' => false, 'updatedById' => $updatedById])->save();
        unset($this->cache[$key]);
    }

    public function setSecret(string $key, ?string $plaintext, ?string $updatedById = null): void
    {
        if (! in_array($key, self::SECRET_KEYS, true)) {
            throw new \InvalidArgumentException("Unknown secret setting {$key}");
        }
        if ($plaintext === null || $plaintext === '') {
            Setting::query()->whereKey($key)->delete();
        } else {
            $row = Setting::query()->find($key) ?? new Setting(['key' => $key]);
            $row->forceFill(['value' => ['ciphertext' => Crypto::encryptSecret($plaintext)], 'isSecret' => true, 'updatedById' => $updatedById])->save();
        }
        unset($this->cache['secret:'.$key]);
    }

    /** Server-only secret access with an env fallback. */
    public function secret(string $key, string $envFallback = ''): string
    {
        $cacheKey = 'secret:'.$key;
        $hit = $this->cache[$cacheKey] ?? null;
        if ($hit && time() - $hit['at'] < self::TTL) {
            return $hit['value'] !== '' ? $hit['value'] : $envFallback;
        }
        try {
            $row = Setting::query()->find($key);
            $ct = is_array($row?->value) ? ($row->value['ciphertext'] ?? null) : null;
            $plain = is_string($ct) && $ct !== '' ? Crypto::decryptSecret($ct) : '';
        } catch (Throwable $e) {
            Log::error('failed to read secret setting', ['key' => $key, 'error' => $e->getMessage()]);

            return $envFallback;
        }
        $this->cache[$cacheKey] = ['value' => $plain, 'at' => time()];

        return $plain !== '' ? $plain : $envFallback;
    }

    /** @return array<string, bool> which secrets are set (never the values) */
    public function secretStatus(): array
    {
        $set = Setting::query()->whereIn('key', self::SECRET_KEYS)->pluck('key')->all();

        return array_combine(self::SECRET_KEYS, array_map(fn ($k) => in_array($k, $set, true), self::SECRET_KEYS));
    }

    public function clearCache(): void
    {
        $this->cache = [];
    }

    /** @return array<string, mixed> */
    public function smsPolicy(): array
    {
        $default = config('smsflow.sms_policy');
        $override = $this->readRaw('sms.policy');
        $override = is_array($override) ? $override : [];
        $policy = array_merge($default, $override);
        $seg = is_array($override['segmentation'] ?? null) ? $override['segmentation'] : [];
        $policy['segmentation'] = array_replace_recursive($default['segmentation'], $seg);
        // A policy saved by the admin may set quiet hours to null (disabled).
        $policy['promotionalQuietHours'] = array_key_exists('promotionalQuietHours', $override) ? $override['promotionalQuietHours'] : $default['promotionalQuietHours'];

        return $policy;
    }

    /** @return array<string, mixed> */
    public function billingPolicy(): array
    {
        $override = $this->readRaw('billing.policy');

        return array_merge(config('smsflow.billing_policy'), is_array($override) ? $override : []);
    }

    /**
     * Campaign batch processing and risk thresholds, clamped to the non-editable hard limits.
     *
     * @return array{defaultBatchSize: int, allowedBatchSizes: list<int>, maxDynamicRows: int, maxBatchesPerTick: int, throttleMs: int, providerConcurrency: array<string, int>, risk: array<string, int>}
     */
    public function campaignProcessing(): array
    {
        $d = config('smsflow.campaign_processing');
        $o = $this->readRaw('campaign.processing');
        $o = is_array($o) ? $o : [];
        $hardBatch = (int) $d['hardMaxBatchSize'];
        $allowed = array_values(array_unique(array_filter(array_map('intval', (array) ($o['allowedBatchSizes'] ?? $d['allowedBatchSizes'])), fn ($n) => $n >= 1 && $n <= $hardBatch)));
        sort($allowed);
        if (! $allowed) {
            $allowed = $d['allowedBatchSizes'];
        }
        $default = (int) ($o['defaultBatchSize'] ?? $d['defaultBatchSize']);
        if (! in_array($default, $allowed, true)) {
            $default = in_array((int) $d['defaultBatchSize'], $allowed, true) ? (int) $d['defaultBatchSize'] : $allowed[count($allowed) - 1];
        }
        $concurrency = [];
        foreach (array_merge($d['providerConcurrency'], is_array($o['providerConcurrency'] ?? null) ? $o['providerConcurrency'] : []) as $k => $v) {
            $concurrency[(string) $k] = max(1, min((int) $d['hardMaxConcurrency'], (int) $v));
        }

        return [
            'defaultBatchSize' => $default,
            'allowedBatchSizes' => $allowed,
            'maxDynamicRows' => max(1, min((int) $d['hardMaxDynamicRows'], (int) ($o['maxDynamicRows'] ?? $d['maxDynamicRows']))),
            'maxBatchesPerTick' => max(1, min(200, (int) ($o['maxBatchesPerTick'] ?? $d['maxBatchesPerTick']))),
            'throttleMs' => max(0, min(5000, (int) ($o['throttleMs'] ?? $d['throttleMs']))),
            'providerConcurrency' => $concurrency,
            'risk' => array_map('intval', array_merge($d['risk'], is_array($o['risk'] ?? null) ? array_intersect_key($o['risk'], $d['risk']) : [])),
        ];
    }

    /** @return array{proofMaxBytes: int, maxOpenRequestsPerOrganization: int, suspiciousAmount: int} */
    public function manualPaymentPolicy(): array
    {
        $d = config('smsflow.manual_payments');
        $o = $this->readRaw('payments.manual');
        $o = is_array($o) ? array_intersect_key($o, $d) : [];
        $p = array_map('intval', array_merge($d, $o));
        $p['proofMaxBytes'] = max(100 * 1024, min(10 * 1024 * 1024, $p['proofMaxBytes']));

        return $p;
    }

    /** @return array{provider: string, url: string, mapping: array<string, string>} */
    public function smsProviderSettings(): array
    {
        $o = $this->readRaw('sms.provider');
        $o = is_array($o) ? $o : [];

        return [
            'provider' => (string) ($o['provider'] ?? config('smsflow.sms.provider') ?: 'mock'),
            'url' => (string) ($o['url'] ?? config('smsflow.sms.provider_url') ?? ''),
            'mapping' => is_array($o['mapping'] ?? null) ? $o['mapping'] : [],
        ];
    }

    /** @return array{enabled: list<string>, manualInstructions: string, sslcommerz: array{storeId: string, live: bool}} */
    public function paymentSettings(): array
    {
        $o = $this->readRaw('payments');
        $o = is_array($o) ? $o : [];
        $envEnabled = array_values(array_filter(array_map('trim', explode(',', (string) config('smsflow.payments.providers')))));

        return [
            'enabled' => array_values($o['enabled'] ?? $envEnabled),
            'manualInstructions' => (string) ($o['manualInstructions'] ?? config('smsflow.payments.manual_instructions')),
            'sslcommerz' => [
                'storeId' => (string) ($o['sslcommerz']['storeId'] ?? config('smsflow.payments.sslcommerz_store_id') ?? ''),
                'live' => (bool) ($o['sslcommerz']['live'] ?? config('smsflow.payments.sslcommerz_live')),
            ],
        ];
    }

    /** @return array{contact: array<string, mixed>, announcement: array<string, mixed>} */
    public function siteContent(): array
    {
        $o = $this->readRaw('site.content');
        $o = is_array($o) ? $o : [];

        return [
            'contact' => is_array($o['contact'] ?? null) ? $o['contact'] : [],
            'announcement' => is_array($o['announcement'] ?? null) ? $o['announcement'] : ['enabled' => false, 'text' => ''],
        ];
    }
}
