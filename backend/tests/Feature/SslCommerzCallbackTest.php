<?php

namespace Tests\Feature;

use App\Models\Payment;
use App\Models\WalletTransaction;
use App\Services\Platform\SettingsService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Concerns\BuildsTenants;
use Tests\TestCase;

/**
 * SSLCommerz callbacks (IPN + browser return), with the validation API faked. Nothing the client
 * or the IPN body asserts can credit the wallet: only a validation response with VALID status, the
 * same tran_id, BDT and the exact expected amount does — once. (Contract per SSLCommerz public
 * docs; UNVERIFIED against a real sandbox account.)
 */
class SslCommerzCallbackTest extends TestCase
{
    use BuildsTenants;
    use RefreshDatabase;

    private const VALIDATOR = 'sandbox.sslcommerz.com/validator/*';

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        config([
            'smsflow.payments.providers' => 'mock,manual,sslcommerz',
            'smsflow.payments.sslcommerz_store_id' => 'teststore',
            'smsflow.payments.sslcommerz_store_password' => 'test-store-password',
            'smsflow.payments.sslcommerz_live' => false,
        ]);
        app(SettingsService::class)->clearCache();
    }

    /** @return array{0: array, 1: Payment} a pending SSLCommerz payment of BDT 1,000 (+15% VAT = 1,150) */
    private function pending(): array
    {
        $t = $this->tenant('0');
        $id = $this->postJson('/api/v1/app/payments', ['amount' => 1000, 'provider' => 'mock'], $t['headers'])->assertCreated()->json('data.payment.id');
        Payment::query()->whereKey($id)->update(['provider' => 'sslcommerz']);

        return [$t, Payment::query()->findOrFail($id)];
    }

    private function ipn(string $tranId, array $extra = []): TestResponse
    {
        return $this->post('/api/v1/webhooks/payments/sslcommerz', $extra + ['tran_id' => $tranId, 'val_id' => 'VAL123', 'status' => 'VALID', 'amount' => '1150.00', 'currency' => 'BDT']);
    }

    public function test_validated_payment_with_matching_amount_is_credited_exactly_once(): void
    {
        [$t, $p] = $this->pending();
        Http::fake([self::VALIDATOR => Http::response(['status' => 'VALID', 'tran_id' => $p->id, 'amount' => '1150.00', 'currency' => 'BDT', 'bank_tran_id' => 'BANK1'])]);
        $this->ipn($p->id)->assertOk()->assertJsonPath('outcome', 'succeeded');
        $this->assertSame('1000.0000', $this->balance($t['org']));
        // IPN retry + browser return for the same payment: no second credit.
        $this->ipn($p->id)->assertOk();
        $this->post('/api/v1/payments/sslcommerz/return', ['tran_id' => $p->id, 'val_id' => 'VAL123', 'status' => 'VALID'])->assertStatus(303);
        $this->assertSame('1000.0000', $this->balance($t['org']));
        $this->assertSame(1, WalletTransaction::query()->where('reason', 'TOPUP')->count());
        $this->assertSame(['SUCCEEDED', 'BANK1'], [$p->refresh()->status->value, $p->providerRef]);
        // The validation call is server-to-server with the store credentials, never the browser's word.
        Http::assertSent(fn ($r) => str_contains($r->url(), 'val_id=VAL123') && str_contains($r->url(), 'store_id=teststore'));
    }

    /** @return array<string, array{0: array<string, mixed>}> */
    public static function rejectedValidations(): array
    {
        return [
            'gateway says INVALID (forged VALID form)' => [['status' => 'INVALID_TRANSACTION']],
            'amount missing' => [['status' => 'VALID', 'currency' => 'BDT']],
            'amount mismatch' => [['status' => 'VALID', 'amount' => '1.00', 'currency' => 'BDT']],
            'currency not BDT' => [['status' => 'VALID', 'amount' => '1150.00', 'currency' => 'USD']],
            'different transaction' => [['status' => 'VALID', 'amount' => '1150.00', 'currency' => 'BDT', 'tran_id' => 'someone-else']],
        ];
    }

    #[DataProvider('rejectedValidations')]
    public function test_unverified_or_mismatched_payments_are_never_credited(array $validation): void
    {
        [$t, $p] = $this->pending();
        Http::fake([self::VALIDATOR => Http::response($validation + ['tran_id' => $p->id])]);
        $this->ipn($p->id); // 200 or 500 (amount mismatch is an error) — either way nothing is credited
        $this->post('/api/v1/payments/sslcommerz/return', ['tran_id' => $p->id, 'val_id' => 'VAL123', 'status' => 'VALID'])->assertStatus(303);
        $this->assertSame('0.0000', $this->balance($t['org']));
        $this->assertSame('PENDING', $p->refresh()->status->value);
        $this->assertSame(0, WalletTransaction::query()->where('reason', 'TOPUP')->count());
    }

    public function test_failure_and_cancel_callbacks_cannot_be_used_to_change_someone_elses_payment(): void
    {
        [, $p] = $this->pending();
        Http::fake();
        $this->ipn($p->id, ['status' => 'FAILED', 'val_id' => ''])->assertOk()->assertJsonPath('outcome', 'failed');
        $this->ipn($p->id, ['status' => 'CANCELLED'])->assertOk()->assertJsonPath('outcome', 'cancelled');
        $this->assertSame('PENDING', $p->refresh()->status->value);
        Http::assertNothingSent();
    }

    public function test_disabled_or_unconfigured_gateway_ignores_callbacks(): void
    {
        [$t, $p] = $this->pending();
        config(['smsflow.payments.sslcommerz_store_password' => '']);
        app(SettingsService::class)->clearCache();
        Http::fake();
        $this->ipn($p->id)->assertOk()->assertJsonPath('outcome', 'unsupported');
        $this->assertSame('0.0000', $this->balance($t['org']));
        Http::assertNothingSent();
    }
}
