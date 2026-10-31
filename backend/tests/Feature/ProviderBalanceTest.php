<?php

namespace Tests\Feature;

use App\Services\Platform\SettingsService;
use App\Services\Sms\Providers\AutomasSmsProvider;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Factory;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Tests\Concerns\BuildsTenants;
use Tests\TestCase;

class ProviderBalanceTest extends TestCase
{
    use BuildsTenants;
    use RefreshDatabase;

    private const URL = 'api.automas.com.bd/*';

    private function useAutomas(): void
    {
        config(['smsflow.sms.provider' => 'automas', 'smsflow.sms.provider_api_key' => 'secret-key']);
        app(SettingsService::class)->clearCache();
        Cache::flush();
    }

    public function test_reads_the_documented_balance_response(): void
    {
        Http::fake([self::URL => Http::response('{"response":"10000.0"}')]);
        $this->assertSame(10000.0, (new AutomasSmsProvider('secret-key'))->balance()['amount']);
        Http::assertSent(fn (Request $q) => str_starts_with($q->url(), 'https://api.automas.com.bd/getbalancev3') && $q['apikey'] === 'secret-key');
    }

    public function test_never_logs_the_key_when_the_request_fails(): void
    {
        Log::spy();
        Http::fake([self::URL => fn () => throw new ConnectionException('timed out for https://api.automas.com.bd/getbalancev3?apikey=secret-key')]);
        $this->assertNull((new AutomasSmsProvider('secret-key'))->balance());
        Log::shouldHaveReceived('warning')->withArgs(fn ($m, $c) => ! str_contains($m.json_encode($c), 'secret-key'));

        Http::swap(new Factory);
        Http::fake([self::URL => Http::response('{"response":"Invalid key"}')]);
        $this->assertNull((new AutomasSmsProvider('secret-key'))->balance());
    }

    public function test_shows_balance_and_rounds_message_counts_down(): void
    {
        $this->useAutomas();
        Http::fake([self::URL => Http::response('{"response":"10000.0"}')]);

        $this->getJson('/api/v1/admin/finance/provider-balance', $this->staff('ADMIN'))->assertOk()
            ->assertJsonPath('data.provider', 'automas')
            ->assertJsonPath('data.available', true)
            ->assertJsonPath('data.balance', '10000.0000')
            ->assertJsonPath('data.maskingCount', 20000)
            ->assertJsonPath('data.nonMaskingCount', 45454)
            ->assertJsonPath('data.maskingRate', '0.50')
            ->assertJsonPath('data.nonMaskingRate', '0.22')
            ->assertJsonPath('data.rateSource', 'price_list')
            ->assertJsonMissingPath('data.apiKey');
    }

    public function test_rates_saved_in_costs_settings_take_priority(): void
    {
        $this->useAutomas();
        app(SettingsService::class)->set('sms.provider.costs', ['provider' => 'automas', 'currency' => 'BDT', 'rates' => ['transactionalMasking' => '1.0000', 'transactionalNonMasking' => '0.2500']], null);
        app(SettingsService::class)->clearCache();
        Http::fake([self::URL => Http::response('{"response":"100"}')]);

        $this->getJson('/api/v1/admin/finance/provider-balance', $this->staff('ADMIN'))->assertOk()
            ->assertJsonPath('data.maskingCount', 100)
            ->assertJsonPath('data.nonMaskingCount', 400)
            ->assertJsonPath('data.rateSource', 'costs_settings');
    }

    public function test_a_gateway_outage_does_not_break_the_page(): void
    {
        $this->useAutomas();
        Http::fake([self::URL => Http::response('down', 503)]);

        $this->getJson('/api/v1/admin/finance/provider-balance', $this->staff('ADMIN'))->assertOk()
            ->assertJsonPath('data.available', false)
            ->assertJsonPath('data.balance', null)
            ->assertJsonPath('data.maskingCount', null);
    }

    public function test_only_finance_staff_can_see_it(): void
    {
        $this->useAutomas();
        Http::fake();
        $this->getJson('/api/v1/admin/finance/provider-balance')->assertUnauthorized();
        $this->getJson('/api/v1/admin/finance/provider-balance', $this->staff('SUPPORT'))->assertForbidden();
        $this->getJson('/api/v1/admin/finance/provider-balance', $this->tenant()['headers'])->assertForbidden();
        Http::assertNothingSent();
    }
}
