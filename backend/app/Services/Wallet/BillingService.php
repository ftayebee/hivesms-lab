<?php

namespace App\Services\Wallet;

use App\Auth\TenantContext;
use App\Exceptions\AppException;
use App\Models\CreditPackage;
use App\Models\Invoice;
use App\Models\Organization;
use App\Models\Payment;
use App\Models\Wallet;
use App\Models\WalletTransaction;
use App\Services\Payment\PaymentProviderManager;
use App\Services\Payment\PaymentService;
use App\Services\Platform\AuditLogger;
use App\Services\Platform\SettingsService;
use App\Services\Sms\SmsCostCalculator;
use App\Support\Csv;
use App\Support\DateRange;
use App\Support\ErrorCode;
use App\Support\Money;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Throwable;

/**
 * Wallet, top-ups, payments, invoices and the transaction ledger for the dashboard (port of
 * features/wallet/service.ts).
 */
class BillingService
{
    public const TX_PAGE_SIZE = 30;

    public function __construct(
        private readonly SettingsService $settings,
        private readonly PaymentProviderManager $providers,
        private readonly PaymentService $payments,
        private readonly WalletService $wallet,
        private readonly SmsCostCalculator $pricing,
        private readonly AuditLogger $audit,
    ) {}

    /** @return array{subtotal: string, vatRate: string, vatAmount: string, total: string, bonus: string, creditAmount: string, packageId: ?string, label: string, bonusPercent: string} */
    public function preview(?string $packageId, ?string $amount): array
    {
        $policy = $this->settings->billingPolicy();
        $bonus = '0';
        $label = 'Custom amount';
        if ($packageId) {
            $pkg = CreditPackage::query()->where('active', true)->find($packageId);
            if (! $pkg) {
                throw new AppException(ErrorCode::VALIDATION_ERROR, 'That package is no longer available.', ['field' => 'packageId']);
            }
            $value = (string) $pkg->amount;
            $bonus = (string) $pkg->bonusPercent;
            $label = $pkg->name;
        } else {
            $value = Money::round($amount ?? '0', 2);
            if (Money::cmp($value, (string) $policy['minimumTopUp']) < 0) {
                throw new AppException(ErrorCode::VALIDATION_ERROR, "The minimum top-up is BDT {$policy['minimumTopUp']}.", ['field' => 'amount']);
            }
            if (Money::cmp($value, (string) $policy['maximumTopUp']) > 0) {
                throw new AppException(ErrorCode::VALIDATION_ERROR, "The maximum online top-up is BDT {$policy['maximumTopUp']}. Contact sales for larger amounts.", ['field' => 'amount']);
            }
            $packageId = null;
        }

        return SmsCostCalculator::topUpBreakdown($value, (string) $policy['vatRatePercent'], $bonus) + ['packageId' => $packageId, 'label' => $label, 'bonusPercent' => Money::plain($bonus)];
    }

    /** @return array{payment: Payment, checkout: array<string, mixed>} */
    public function createTopUp(TenantContext $ctx, ?string $packageId, ?string $amount, string $providerKey, array $customer): array
    {
        $ctx->requirePermission('billing:manage');
        $ctx->assertActive();
        $provider = $this->providers->provider($providerKey);
        if (! $provider) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'That payment method is not available.', ['field' => 'provider']);
        }
        $b = $this->preview($packageId, $amount);
        $recent = Payment::query()->where('organizationId', $ctx->organizationId)->where('status', 'PENDING')->where('createdAt', '>=', now()->subHour()->format('Y-m-d H:i:s.v'))->count();
        if ($recent >= 10) {
            throw new AppException(ErrorCode::RATE_LIMITED, 'Too many unfinished payments. Complete or cancel an existing one first.');
        }
        $orgName = Organization::query()->whereKey($ctx->organizationId)->value('name');
        $payment = Payment::query()->forceCreate([
            'organizationId' => $ctx->organizationId, 'provider' => $provider->key(), 'packageId' => $b['packageId'],
            'amount' => $b['subtotal'], 'vatRate' => $b['vatRate'], 'vatAmount' => $b['vatAmount'], 'total' => $b['total'],
            'creditAmount' => $b['creditAmount'], 'method' => $provider->displayName(), 'initiatedById' => $ctx->userId,
            'metadata' => ['label' => $b['label'], 'bonusPercent' => $b['bonusPercent']],
        ]);
        $base = rtrim((string) config('app.url'), '/');
        try {
            $checkout = $provider->createCheckout([
                'paymentId' => $payment->id, 'total' => Money::round($b['total'], 2), 'currency' => 'BDT', 'description' => "SMS wallet top-up ({$b['label']})",
                'customer' => ['name' => $customer['name'], 'email' => $customer['email'], 'phone' => $customer['phone'] ?? null, 'organization' => (string) $orgName],
                'successUrl' => "{$base}/api/v1/payments/{$provider->key()}/return?status=success",
                'failUrl' => "{$base}/api/v1/payments/{$provider->key()}/return?status=fail",
                'cancelUrl' => "{$base}/api/v1/payments/{$provider->key()}/return?status=cancel",
                'callbackUrl' => "{$base}/api/v1/webhooks/payments/{$provider->key()}",
            ]);
        } catch (Throwable $e) {
            $payment->forceFill(['status' => 'FAILED', 'failureReason' => 'Could not start the payment session.'])->save();
            throw new AppException(ErrorCode::PAYMENT_FAILED, 'Could not start the payment. Try again or choose another method.');
        }
        $payment->forceFill([
            'providerRef' => $checkout['type'] === 'redirect' ? ($checkout['providerRef'] ?? null) : null,
            'metadata' => ['label' => $b['label'], 'bonusPercent' => $b['bonusPercent'], 'checkout' => $checkout['type']],
        ])->save();
        $this->audit->log('payment.create', $ctx->actor(), $ctx->organizationId, 'payment', $payment->id, ['provider' => $provider->key(), 'total' => Money::round($b['total'], 2)]);

        return ['payment' => $payment, 'checkout' => $checkout];
    }

    public function payment(TenantContext $ctx, string $id): Payment
    {
        $ctx->requirePermission('billing:read');

        return Payment::query()->with('invoice:id,paymentId,number')->where('organizationId', $ctx->organizationId)->whereKey($id)->first()
            ?? throw new AppException(ErrorCode::NOT_FOUND, 'Payment not found.');
    }

    public function payments(TenantContext $ctx, int $page): LengthAwarePaginator
    {
        $ctx->requirePermission('billing:read');

        return Payment::query()->with('invoice:id,paymentId,number')->where('organizationId', $ctx->organizationId)->orderByDesc('createdAt')->paginate(20, ['*'], 'page', $page);
    }

    public function submitManualReference(TenantContext $ctx, string $id, string $reference): void
    {
        $ctx->requirePermission('billing:manage');
        $p = $this->payment($ctx, $id);
        if ($p->provider !== 'manual') {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'This payment does not use manual verification.');
        }
        if (! Payment::query()->whereKey($id)->whereIn('status', ['PENDING', 'AWAITING_VERIFICATION'])->update(['status' => 'AWAITING_VERIFICATION', 'manualReference' => $reference])) {
            throw new AppException(ErrorCode::CONFLICT, 'This payment can no longer be updated.');
        }
        $this->audit->log('payment.reference_submitted', $ctx->actor(), $ctx->organizationId, 'payment', $id);
    }

    public function cancelPending(TenantContext $ctx, string $id): void
    {
        $ctx->requirePermission('billing:manage');
        $this->payment($ctx, $id);
        if (! Payment::query()->whereKey($id)->where('status', 'PENDING')->update(['status' => 'CANCELLED', 'failureReason' => 'Cancelled by customer'])) {
            throw new AppException(ErrorCode::CONFLICT, 'Only unpaid payments can be cancelled.');
        }
        $this->audit->log('payment.cancelled', $ctx->actor(), $ctx->organizationId, 'payment', $id);
    }

    /** Development/staging simulated gateway outcome. */
    public function mockComplete(TenantContext $ctx, string $id, string $outcome): Payment
    {
        if (! PaymentProviderManager::mockAllowed()) {
            throw new AppException(ErrorCode::FORBIDDEN, 'Mock payments are disabled.');
        }
        $ctx->requirePermission('billing:manage');
        $p = $this->payment($ctx, $id);
        if ($p->provider !== 'mock') {
            throw new AppException(ErrorCode::FORBIDDEN, 'Not a test payment.');
        }
        if ($outcome === 'success') {
            $this->payments->complete($p->id, ['type' => 'SYSTEM'], 'MOCK-'.now()->getTimestampMs(), Money::round((string) $p->total, 2), 'mock gateway');
        } else {
            $this->payments->fail($p->id, $outcome === 'cancel' ? 'Cancelled at the test gateway' : 'Declined at the test gateway', ['type' => 'SYSTEM'], $outcome === 'cancel' ? 'CANCELLED' : 'FAILED');
        }

        return $this->payment($ctx, $id);
    }

    /** @return Collection<int, Invoice> */
    public function invoices(TenantContext $ctx, int $take = 50): Collection
    {
        $ctx->requirePermission('billing:read');

        return Invoice::query()->where('organizationId', $ctx->organizationId)->orderByDesc('issuedAt')->limit($take)->get();
    }

    public function invoice(TenantContext $ctx, string $id): Invoice
    {
        $ctx->requirePermission('billing:read');

        return Invoice::query()->with('payment:id,method,providerRef,manualReference,completedAt,creditAmount')->where('organizationId', $ctx->organizationId)->whereKey($id)->first()
            ?? throw new AppException(ErrorCode::NOT_FOUND, 'Invoice not found.');
    }

    /** @param array{type?: ?string, reason?: ?string, reference?: ?string, campaignId?: ?string} $f */
    private function txQuery(TenantContext $ctx, DateRange $range, array $f): Builder
    {
        return WalletTransaction::query()
            ->where('organizationId', $ctx->organizationId)
            ->where('createdAt', '>=', $range->from->format('Y-m-d H:i:s.v'))
            ->where('createdAt', '<', $range->to->format('Y-m-d H:i:s.v'))
            ->when($f['type'] ?? null, fn ($q, $v) => $q->where('type', $v))
            ->when($f['reason'] ?? null, fn ($q, $v) => $q->where('reason', $v))
            ->when($f['reference'] ?? null, fn ($q, $v) => $q->where('referenceId', $v))
            ->when($f['campaignId'] ?? null, fn ($q, $v) => $q->where('referenceType', 'campaign')->where('referenceId', $v));
    }

    /** @return array{page: LengthAwarePaginator, credit: string, debit: string} */
    public function transactions(TenantContext $ctx, DateRange $range, array $f, int $page): array
    {
        $ctx->requirePermission('billing:read');
        $q = $this->txQuery($ctx, $range, $f);
        $sums = (clone $q)->groupBy('type')->selectRaw('type, CAST(COALESCE(SUM(amount), 0) AS CHAR) AS total')->pluck('total', 'type');

        return [
            'page' => $q->orderByDesc('createdAt')->paginate(self::TX_PAGE_SIZE, ['*'], 'page', $page),
            'credit' => Money::round((string) ($sums['CREDIT'] ?? '0'), 2),
            'debit' => Money::round((string) ($sums['DEBIT'] ?? '0'), 2),
        ];
    }

    public function transaction(TenantContext $ctx, string $id): WalletTransaction
    {
        $ctx->requirePermission('billing:read');

        return WalletTransaction::query()->where('organizationId', $ctx->organizationId)->whereKey($id)->first()
            ?? throw new AppException(ErrorCode::NOT_FOUND, 'Transaction not found.');
    }

    public function exportTransactions(TenantContext $ctx, DateRange $range, array $f, callable $write): void
    {
        $ctx->requirePermission('billing:read');
        $write(Csv::bom().Csv::line(['date', 'type', 'reason', 'description', 'amount_bdt', 'balance_after_bdt', 'reference_type', 'reference_id', 'transaction_id']));
        $count = 0;
        $this->txQuery($ctx, $range, $f)->chunkById(5000, function ($rows) use ($write, &$count) {
            $out = '';
            foreach ($rows as $r) {
                $out .= Csv::line([$r->createdAt, $r->type->value, $r->reason->value, $r->description, ($r->type->value === 'DEBIT' ? '-' : '').Money::round((string) $r->amount, 2), Money::round((string) $r->balanceAfter, 2), $r->referenceType, $r->referenceId, $r->id]);
                $count++;
            }
            $write($out);

            return $count < 100000;
        });
    }

    public function updateLowBalanceThreshold(TenantContext $ctx, string $threshold): void
    {
        $ctx->requirePermission('billing:manage');
        Wallet::query()->where('organizationId', $ctx->organizationId)->update(['lowBalanceThreshold' => Money::round($threshold, 2), 'lowBalanceNotifiedAt' => null]);
        $this->audit->log('wallet.threshold_update', $ctx->actor(), $ctx->organizationId, metadata: ['threshold' => (float) $threshold]);
    }

    /** @return array{balance: string, currency: string, lowBalanceThreshold: string, credits: int, maskingCredits: int, rate: string, planName: string} */
    public function summary(TenantContext $ctx): array
    {
        $w = $this->wallet->wallet($ctx->organizationId);
        $plan = $this->pricing->planFor($ctx->organizationId);
        $balance = $w ? (string) $w->balance : '0';
        $rate = SmsCostCalculator::rateFor($plan, 'TRANSACTIONAL', 'NON_MASKING');
        $maskRate = SmsCostCalculator::rateFor($plan, 'TRANSACTIONAL', 'MASKING');

        return [
            'balance' => Money::round($balance, 4),
            'currency' => $w->currency ?? 'BDT',
            'lowBalanceThreshold' => Money::round($w ? (string) $w->lowBalanceThreshold : '0', 2),
            'credits' => Money::isPositive($rate) ? Money::floorInt(Money::div($balance, $rate)) : 0,
            'maskingCredits' => Money::isPositive($maskRate) ? Money::floorInt(Money::div($balance, $maskRate)) : 0,
            'rate' => Money::round($rate, 4),
            'planName' => $plan->name,
        ];
    }

    /** @return list<array{id: ?string, name: string, amount: string, bonusPercent: string, description: ?string}> */
    public function packages(): array
    {
        return CreditPackage::query()->where('active', true)->orderBy('sortOrder')->get()
            ->map(fn (CreditPackage $p) => ['id' => $p->id, 'name' => $p->name, 'amount' => Money::round((string) $p->amount, 2), 'bonusPercent' => Money::plain((string) $p->bonusPercent), 'description' => $p->description])
            ->all();
    }
}
