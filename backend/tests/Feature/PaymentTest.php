<?php

namespace Tests\Feature;

use App\Exceptions\AppException;
use App\Models\CreditPackage;
use App\Models\InboundWebhookEvent;
use App\Models\Invoice;
use App\Models\Payment;
use App\Models\WalletTransaction;
use App\Services\Payment\PaymentService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\Concerns\BuildsTenants;
use Tests\TestCase;

class PaymentTest extends TestCase
{
    use BuildsTenants;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
    }

    public function test_methods_and_preview_with_vat_and_package_bonus(): void
    {
        $t = $this->tenant('0');
        $pkg = CreditPackage::query()->forceCreate(['name' => 'BDT 5,000', 'amount' => '5000', 'bonusPercent' => '2', 'active' => true]);
        $this->getJson('/api/v1/app/payments/methods', $t['headers'])->assertOk()->assertJsonPath('data.providers.0.key', 'mock')->assertJsonPath('data.providers.1.key', 'manual');
        $this->postJson('/api/v1/app/payments/preview', ['packageId' => $pkg->id], $t['headers'])
            ->assertOk()->assertJsonPath('data.subtotal', '5000.00')->assertJsonPath('data.vatAmount', '750.00')->assertJsonPath('data.total', '5750.00')->assertJsonPath('data.creditAmount', '5100.00');
        $this->postJson('/api/v1/app/payments/preview', ['amount' => 100], $t['headers'])->assertStatus(422)->assertJsonPath('error.details.field', 'amount');
    }

    public function test_mock_checkout_credits_wallet_once_and_issues_invoice(): void
    {
        $t = $this->tenant('0');
        $res = $this->postJson('/api/v1/app/payments', ['amount' => 1000, 'provider' => 'mock'], $t['headers'])->assertCreated()->assertJsonPath('data.checkout.type', 'redirect');
        $id = $res->json('data.payment.id');
        $this->assertSame('PENDING', $res->json('data.payment.status'));
        $this->postJson("/api/v1/app/payments/{$id}/mock-complete", ['outcome' => 'success'], $t['headers'])->assertOk()->assertJsonPath('data.status', 'SUCCEEDED');
        $this->assertSame('1000.0000', $this->balance($t['org']));
        $inv = Invoice::query()->where('paymentId', $id)->firstOrFail();
        $this->assertMatchesRegularExpression('/^INV-\d{4}-001001$/', $inv->number);
        $this->assertSame('1150.0000', (string) $inv->total);

        // A duplicated completion (webhook retry, double click) never credits twice.
        $again = app(PaymentService::class)->complete($id, ['type' => 'SYSTEM']);
        $this->assertSame('already_completed', $again['status']);
        $this->assertSame('1000.0000', $this->balance($t['org']));
        $this->assertSame(1, WalletTransaction::query()->where('reason', 'TOPUP')->count());
        $this->assertSame(1, Invoice::query()->count());
        $this->getJson('/api/v1/app/wallet/invoices', $t['headers'])->assertJsonPath('data.0.number', $inv->number);
    }

    public function test_failed_or_cancelled_payment_adds_nothing(): void
    {
        $t = $this->tenant('0');
        $id = $this->postJson('/api/v1/app/payments', ['amount' => 1000, 'provider' => 'mock'], $t['headers'])->json('data.payment.id');
        $this->postJson("/api/v1/app/payments/{$id}/mock-complete", ['outcome' => 'fail'], $t['headers'])->assertJsonPath('data.status', 'FAILED');
        $this->assertSame('0.0000', $this->balance($t['org']));
        $this->expectExceptionMessage('Payment is failed and cannot be completed.');
        app(PaymentService::class)->complete($id, ['type' => 'SYSTEM']);
    }

    public function test_confirmed_amount_must_match_total(): void
    {
        $t = $this->tenant('0');
        $id = $this->postJson('/api/v1/app/payments', ['amount' => 1000, 'provider' => 'mock'], $t['headers'])->json('data.payment.id');
        try {
            app(PaymentService::class)->complete($id, ['type' => 'SYSTEM'], 'X', '1.00');
            $this->fail('amount mismatch accepted');
        } catch (AppException $e) {
            $this->assertSame('PAYMENT_FAILED', $e->errorCode->value);
        }
        $this->assertSame('PENDING', Payment::query()->findOrFail($id)->status->value);
    }

    public function test_manual_payment_reference_then_admin_approval(): void
    {
        $t = $this->tenant('0');
        $res = $this->postJson('/api/v1/app/payments', ['amount' => 600, 'provider' => 'manual'], $t['headers'])->assertCreated()->assertJsonPath('data.checkout.type', 'manual');
        $id = $res->json('data.payment.id');
        $this->postJson("/api/v1/app/payments/{$id}/reference", ['reference' => 'BKASH-TRX-9'], $t['headers'])->assertOk()->assertJsonPath('data.status', 'AWAITING_VERIFICATION');

        $admin = $this->staff('ADMIN');
        $this->postJson("/api/v1/admin/payments/{$id}/review", ['decision' => 'reject'], $admin)->assertStatus(422);
        $this->postJson("/api/v1/admin/payments/{$id}/review", ['decision' => 'approve'], $admin)->assertOk()->assertJsonPath('data.decision', 'approve');
        $this->assertSame('600.0000', $this->balance($t['org']));
        $this->postJson("/api/v1/admin/payments/{$id}/review", ['decision' => 'approve'], $admin)->assertOk(); // idempotent
        $this->assertSame('600.0000', $this->balance($t['org']));
        $this->postJson("/api/v1/admin/payments/{$id}/review", ['decision' => 'approve'], $this->staff('SUPPORT'))->assertStatus(403);
    }

    public function test_customer_cannot_complete_or_read_other_payments(): void
    {
        $a = $this->tenant('0');
        $b = $this->tenant('0');
        $id = $this->postJson('/api/v1/app/payments', ['amount' => 1000, 'provider' => 'mock'], $a['headers'])->json('data.payment.id');
        $this->getJson("/api/v1/app/payments/{$id}", $b['headers'])->assertStatus(404);
        $this->postJson("/api/v1/app/payments/{$id}/mock-complete", ['outcome' => 'success'], $b['headers'])->assertStatus(404);
        $this->assertSame('0.0000', $this->balance($a['org']));
    }

    public function test_payment_callbacks_for_unknown_or_disabled_providers_change_nothing(): void
    {
        $t = $this->tenant('0');
        $id = $this->postJson('/api/v1/app/payments', ['amount' => 1000, 'provider' => 'mock'], $t['headers'])->json('data.payment.id');
        $this->post('/api/v1/webhooks/payments/sslcommerz', ['tran_id' => $id, 'status' => 'VALID', 'val_id' => 'x'])->assertOk()->assertJsonPath('outcome', 'unsupported');
        $this->get('/api/v1/payments/sslcommerz/return?status=success')->assertStatus(303)->assertRedirect('http://localhost:3000/dashboard/wallet?payment=unknown');
        $this->assertSame('PENDING', Payment::query()->findOrFail($id)->status->value);
        $this->assertSame(0, InboundWebhookEvent::query()->count());
    }

    public function test_transactions_history_filters_and_ownership(): void
    {
        $t = $this->tenant('0');
        $id = $this->postJson('/api/v1/app/payments', ['amount' => 1000, 'provider' => 'mock'], $t['headers'])->json('data.payment.id');
        $this->postJson("/api/v1/app/payments/{$id}/mock-complete", ['outcome' => 'success'], $t['headers']);
        $res = $this->getJson('/api/v1/app/wallet/transactions?type=CREDIT', $t['headers'])->assertOk()->assertJsonPath('meta.total', 1)->assertJsonPath('meta.credit', '1000.00')->assertJsonPath('data.0.reason', 'TOPUP');
        $txId = $res->json('data.0.id');
        $this->getJson("/api/v1/app/wallet/transactions/{$txId}", $t['headers'])->assertOk()->assertJsonPath('data.balanceAfter', '1000.00');
        $this->getJson("/api/v1/app/wallet/transactions/{$txId}", $this->tenant()['headers'])->assertStatus(404);
        $this->getJson("/api/v1/app/wallet/transactions?reference={$id}", $t['headers'])->assertJsonPath('meta.total', 1);
        $csv = $this->get('/api/v1/app/wallet/transactions/export', $t['headers'])->assertOk()->streamedContent();
        $this->assertStringContainsString('"TOPUP"', $csv);
        $this->getJson('/api/v1/app/wallet', $t['headers'])->assertOk()->assertJsonPath('data.balance', '1000.0000')->assertJsonPath('data.credits', 2500);
    }
}
