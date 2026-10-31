<?php

namespace App\Services\Platform;

use App\Models\Message;
use App\Services\Sms\SmsProviderManager;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Dependency and production-safeguard checks shared by GET /internal/ready (CRON_SECRET, for
 * monitoring) and GET /admin/system/health (staff with admin:health:read). Reports only ok/fail
 * per check — never hosts, credentials, versions or secret values.
 */
class ReadinessService
{
    public function __construct(private readonly SettingsService $settings, private readonly SmsProviderManager $providers) {}

    /** @return array{ok: bool, checks: array<string, string>} */
    public function run(): array
    {
        $settings = $this->settings;
        $providers = $this->providers;
        $checks = [];
        $ok = true;
        $run = function (string $name, callable $fn, bool $required = true) use (&$checks, &$ok) {
            try {
                $checks[$name] = $fn() ?: 'ok';
            } catch (Throwable) {
                $checks[$name] = 'fail';
                $ok = $ok && ! $required;
            }
        };
        $run('database', fn () => DB::select('SELECT 1') ? 'ok' : 'fail');
        $run('cache', function () {
            Cache::put('health:probe', 1, 10);

            return Cache::get('health:probe') === 1 ? 'ok' : throw new \RuntimeException;
        });
        $fail = fn () => throw new \RuntimeException;
        $prod = app()->isProduction();
        $run('secrets', function () use ($fail) {
            foreach (['api_key_pepper', 'settings_encryption_key', 'auth_secret', 'cron_secret', 'frontend_proxy_secret'] as $k) {
                if (strlen((string) config("smsflow.{$k}")) < ($k === 'cron_secret' ? 16 : 32)) {
                    $fail();
                }
            }

            return 'ok';
        });
        $run('appKey', fn () => (string) config('app.key') !== '' ? 'ok' : $fail());
        // Production safeguards: nothing simulated, nothing that leaks internals.
        $run('debugOff', fn () => ! $prod || ! config('app.debug') ? 'ok' : $fail());
        $run('smsProvider', function () use ($providers, $settings, $prod, $fail) {
            $p = $providers->sendingProvider(); // throws for mock in production
            if ($prod && $p->key() === 'http' && ($settings->smsProviderSettings()['url'] === '' || $settings->secret('sms.provider.apiKey', (string) config('smsflow.sms.provider_api_key')) === '')) {
                $fail();
            }
            if ($prod && $p->key() === 'automas' && $settings->secret('sms.provider.apiKey', (string) config('smsflow.sms.provider_api_key')) === '') {
                $fail();
            }

            return $p->verified() ? 'ok' : 'ok (adapter not verified against the provider)';
        });
        $run('smsWebhookSecret', fn () => ! $prod || ! $providers->provider()->hasDeliveryReports() || $settings->secret('sms.provider.webhookSecret', (string) config('smsflow.sms.provider_webhook_secret')) !== '' ? 'ok' : $fail());
        $run('mockPaymentsOff', fn () => ! $prod || ! config('smsflow.features.allow_mock_payments') ? 'ok' : $fail());
        $run('mailer', fn () => ! $prod || ! in_array(config('mail.default'), ['log', 'array'], true) ? 'ok' : $fail());
        $run('sessionDriver', fn () => config('session.driver') !== 'database' ? 'ok' : $fail()); // `sessions` belongs to the app
        $run('scheduler', function () use ($prod, $fail) {
            $last = Cache::get('sms:worker:last-tick');
            if (! $last) {
                return $prod ? $fail() : 'no tick yet';
            }

            return time() - (int) $last < 300 ? 'ok' : $fail();
        });
        $run('queueBacklog', fn () => DB::table('jobs')->count() < 10000 ? 'ok' : 'high', false);
        $run('failedJobs', fn () => (string) DB::table('failed_jobs')->where('failed_at', '>=', now()->subDay())->count(), false);
        $run('stuckQueuedMessages', fn () => (string) Message::query()->where('status', 'QUEUED')->where('nextAttemptAt', '<=', now()->subMinutes(5)->format('Y-m-d H:i:s.v'))->count(), false);

        return ['ok' => $ok, 'checks' => $checks];
    }
}
