<?php

namespace App\Services\Admin;

use App\Auth\AdminContext;
use App\Exceptions\AppException;
use App\Models\Organization;
use App\Models\Payment;
use App\Models\WalletTransaction;
use App\Services\Platform\AuditLogger;
use App\Services\Platform\NotificationService;
use App\Services\Platform\SettingsService;
use App\Services\Wallet\WalletService;
use App\Support\DateRange;
use App\Support\Dhaka;
use App\Support\ErrorCode;
use App\Support\Money;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

/**
 * Platform finance for the Super Admin panel. Definitions (shown in the UI as written here):
 *  - Wallet liability: sum of customer wallet balances now — prepaid money owed as SMS, not revenue.
 *  - Payment receipts: confirmed (SUCCEEDED) payments; `amount` excludes VAT, `total` includes it.
 *  - Usage revenue: SMS charges − failed-SMS refunds + sender-ID fees, from the immutable ledger
 *    (excl. VAT, what customers actually consumed in the period).
 *  - Provider cost and margin: ESTIMATES from admin-configured wholesale rates × segments of
 *    messages handed to the provider. There is no provider-invoice reconciliation, so nothing here
 *    is labelled actual cost or profit. Payment-gateway fees are not recorded, so not deducted.
 *
 * Money moves only through WalletService (row-locked, never negative, unique ledger reference).
 */
class FinanceService
{
    public const COST_KEY = 'sms.provider.costs';

    public const RATE_KEYS = ['transactionalMasking', 'transactionalNonMasking', 'promotionalMasking', 'promotionalNonMasking'];

    public function __construct(
        private readonly AuditLogger $audit,
        private readonly WalletService $wallet,
        private readonly SettingsService $settings,
        private readonly NotificationService $notifications,
    ) {}

    private static function ts(\DateTimeInterface $d): string
    {
        return $d->format('Y-m-d H:i:s.v');
    }

    // ─── Summary ───

    public function summary(DateRange $range): array
    {
        [$from, $to] = [self::ts($range->from), self::ts($range->to)];
        $liability = DB::selectOne('SELECT COUNT(*) AS wallets, CAST(COALESCE(SUM(balance), 0) AS CHAR) AS balance,
            COUNT(CASE WHEN balance > 0 THEN 1 END) AS funded FROM wallets');
        $receipts = DB::selectOne("SELECT COUNT(*) AS count, CAST(COALESCE(SUM(amount), 0) AS CHAR) AS net, CAST(COALESCE(SUM(vatAmount), 0) AS CHAR) AS vat,
            CAST(COALESCE(SUM(total), 0) AS CHAR) AS gross, CAST(COALESCE(SUM(creditAmount - amount), 0) AS CHAR) AS bonus
            FROM payments WHERE status = 'SUCCEEDED' AND completedAt >= ? AND completedAt < ?", [$from, $to]);
        $ledger = collect(DB::select('SELECT reason, type, referenceType, COUNT(*) AS count, CAST(SUM(amount) AS CHAR) AS amount
            FROM wallet_transactions WHERE createdAt >= ? AND createdAt < ? GROUP BY reason, type, referenceType', [$from, $to]));
        $sum = fn (callable $f) => $ledger->filter($f)->reduce(fn ($c, $r) => Money::add($c, $r->amount), '0');
        $cnt = fn (callable $f) => (int) $ledger->filter($f)->sum('count');

        $smsCharges = $sum(fn ($r) => $r->reason === 'SMS_CHARGE' && $r->type === 'DEBIT');
        $smsRefunds = $sum(fn ($r) => $r->reason === 'REFUND' && $r->type === 'CREDIT');
        $senderFees = $sum(fn ($r) => $r->reason === 'SENDER_ID_FEE' && $r->type === 'DEBIT');
        $paymentRefunds = $sum(fn ($r) => $r->referenceType === 'payment_refund');
        $adjCredit = $sum(fn ($r) => $r->reason === 'ADJUSTMENT' && $r->type === 'CREDIT' && $r->referenceType !== 'payment_refund');
        $adjDebit = $sum(fn ($r) => $r->reason === 'ADJUSTMENT' && $r->type === 'DEBIT' && $r->referenceType !== 'payment_refund');
        $usage = Money::add(Money::sub($smsCharges, $smsRefunds), $senderFees);
        $margin = $this->marginTotals($range);

        return [
            'range' => $range->toArray(),
            'liability' => ['balance' => Money::round($liability->balance, 2), 'wallets' => (int) $liability->wallets, 'funded' => (int) $liability->funded],
            'receipts' => ['count' => (int) $receipts->count, 'net' => Money::round($receipts->net, 2), 'vat' => Money::round($receipts->vat, 2), 'gross' => Money::round($receipts->gross, 2), 'bonusCredit' => Money::round($receipts->bonus, 2)],
            'paymentRefunds' => ['count' => $cnt(fn ($r) => $r->referenceType === 'payment_refund'), 'amount' => Money::round($paymentRefunds, 2)],
            'usage' => [
                'smsCharges' => Money::round($smsCharges, 2), 'smsRefunds' => Money::round($smsRefunds, 2), 'senderIdFees' => Money::round($senderFees, 2),
                'revenue' => Money::round($usage, 2),
            ],
            'adjustments' => ['credit' => Money::round($adjCredit, 2), 'debit' => Money::round($adjDebit, 2), 'count' => $cnt(fn ($r) => $r->reason === 'ADJUSTMENT' && $r->referenceType !== 'payment_refund')],
            'pendingManualPayments' => Payment::query()->where('status', 'AWAITING_VERIFICATION')->count(),
            'providerCost' => $margin,
        ];
    }

    // ─── Ledger ───

    /** @param array{organizationId?: ?string, reason?: ?string, type?: ?string} $f */
    public function ledgerQuery(DateRange $range, array $f)
    {
        return WalletTransaction::query()
            ->where('createdAt', '>=', self::ts($range->from))->where('createdAt', '<', self::ts($range->to))
            ->when($f['organizationId'] ?? null, fn ($q, $v) => $q->where('organizationId', $v))
            ->when($f['reason'] ?? null, fn ($q, $v) => $q->where('reason', $v))
            ->when($f['type'] ?? null, fn ($q, $v) => $q->where('type', $v))
            ->orderByDesc('createdAt')->orderByDesc('id');
    }

    public function ledger(DateRange $range, array $f, int $page): LengthAwarePaginator
    {
        return $this->ledgerQuery($range, $f)
            ->with(['organization' => fn ($q) => $q->withTrashed()->select(['id', 'name'])])
            ->paginate(50, ['*'], 'page', $page);
    }

    // ─── Manual adjustments (idempotent) ───

    /**
     * Manual credit or debit with a mandatory reason. The client's idempotency key becomes the
     * ledger reference, whose (reason, referenceType, referenceId) key is unique: a retried or
     * double-submitted request returns the first result and never applies twice.
     *
     * @return array{transaction: WalletTransaction, replayed: bool}
     */
    public function adjust(AdminContext $admin, string $orgId, string $direction, string $amount, string $reason, string $idempotencyKey): array
    {
        if (! Organization::query()->withTrashed()->whereKey($orgId)->exists()) {
            throw new AppException(ErrorCode::NOT_FOUND, 'Organization not found.');
        }
        $amount = Money::round($amount, 2);
        $ref = ['reason' => 'ADJUSTMENT', 'referenceType' => 'admin_adjustment', 'referenceId' => $idempotencyKey];
        $replay = function () use ($ref, $orgId, $direction, $amount) {
            $tx = WalletTransaction::query()->where($ref)->first();
            if (! $tx) {
                return null;
            }
            if ($tx->organizationId !== $orgId || $tx->type->value !== $direction || Money::cmp((string) $tx->amount, $amount) !== 0) {
                throw new AppException(ErrorCode::IDEMPOTENCY_CONFLICT, 'This idempotency key was already used for a different adjustment.');
            }

            return ['transaction' => $tx, 'replayed' => true];
        };
        if ($r = $replay()) {
            return $r;
        }
        $this->wallet->ensureWallet($orgId);
        try {
            $tx = DB::transaction(function () use ($admin, $orgId, $direction, $amount, $reason, $ref) {
                $entry = $ref + ['organizationId' => $orgId, 'amount' => $amount, 'description' => "Adjustment: {$reason}", 'createdById' => $admin->userId];
                $tx = $direction === 'CREDIT' ? $this->wallet->credit($entry) : $this->wallet->debit($entry);
                $after = (string) $tx->balanceAfter;
                $before = $direction === 'CREDIT' ? Money::sub($after, $amount) : Money::add($after, $amount);
                $this->audit->log('admin.wallet.adjust', $admin->actor(), $orgId, 'wallet', $orgId, [
                    'direction' => $direction, 'amount' => $amount, 'reason' => $reason, 'transactionId' => $tx->id,
                    'balanceBefore' => Money::round($before, 4), 'balanceAfter' => Money::round($after, 4),
                ], $admin->ip, $admin->userAgent);

                return $tx;
            });
        } catch (UniqueConstraintViolationException) {
            // A concurrent request with the same key committed first.
            return $replay() ?? throw new AppException(ErrorCode::CONFLICT, 'This adjustment is already being processed.');
        }

        return ['transaction' => $tx, 'replayed' => false];
    }

    // ─── Payment refunds ───

    /**
     * Records the refund of a confirmed payment: removes the credited amount from the wallet
     * (fails if the customer has already used it — never negative) and marks the payment REFUNDED,
     * atomically. The ledger reference (payment_refund, paymentId) is unique, so a payment can be
     * refunded once. The money itself is returned outside the system (bank / mobile wallet).
     */
    public function refundPayment(AdminContext $admin, string $paymentId, string $reason): Payment
    {
        $payment = DB::transaction(function () use ($admin, $paymentId, $reason) {
            $p = Payment::query()->lockForUpdate()->find($paymentId) ?? throw new AppException(ErrorCode::NOT_FOUND, 'Payment not found.');
            if ($p->status->value === 'REFUNDED') {
                throw new AppException(ErrorCode::CONFLICT, 'This payment was already refunded.');
            }
            if ($p->status->value !== 'SUCCEEDED') {
                throw new AppException(ErrorCode::CONFLICT, 'Only confirmed payments can be refunded.');
            }
            try {
                $tx = $this->wallet->debit([
                    'organizationId' => $p->organizationId, 'amount' => (string) $p->creditAmount, 'reason' => 'ADJUSTMENT',
                    'description' => 'Refund of payment '.substr($p->id, 0, 8).": {$reason}", 'referenceType' => 'payment_refund', 'referenceId' => $p->id,
                    'createdById' => $admin->userId,
                ]);
            } catch (AppException $e) {
                if ($e->errorCode === ErrorCode::INSUFFICIENT_BALANCE) {
                    throw new AppException(ErrorCode::CONFLICT, 'The customer has already used part of this credit, so the wallet cannot be reduced by the full amount. Refund the unused part with a wallet adjustment instead.');
                }
                throw $e;
            }
            $meta = (array) ($p->metadata ?? []);
            $meta['refund'] = ['at' => Dhaka::iso(now()), 'byUserId' => $admin->userId, 'reason' => $reason, 'walletDebit' => Money::plain((string) $p->creditAmount), 'transactionId' => $tx->id];
            $p->forceFill(['status' => 'REFUNDED', 'metadata' => $meta])->save();
            $this->audit->log('payment.refund', $admin->actor(), $p->organizationId, 'payment', $p->id, [
                'total' => Money::plain((string) $p->total), 'walletDebit' => Money::plain((string) $p->creditAmount), 'reason' => $reason, 'transactionId' => $tx->id,
            ], $admin->ip, $admin->userAgent);

            return $p;
        });
        // Same preference/recipients as other payment notices (no new notification type in both apps).
        $this->notifications->notify($payment->organizationId, 'payment.succeeded', 'Payment refunded', 'Your payment of '.Money::formatBdt((string) $payment->total).' was refunded and the credit removed from your wallet.', '/dashboard/wallet');

        return $payment;
    }

    // ─── Provider costs (configuration only; never touches the sending provider) ───

    /** @return array{provider: string, currency: string, rates: array<string, string>, effectiveFrom: string, source: string, updatedAt: ?string, updatedById: ?string}|null */
    public function providerCosts(): ?array
    {
        $v = $this->settings->get(self::COST_KEY);

        return is_array($v) && isset($v['rates']) ? $v : null;
    }

    /** @param array{provider: string, rates: array<string, string>, effectiveFrom: string, source: string} $input */
    public function saveProviderCosts(AdminContext $admin, array $input, string $reason): array
    {
        $before = $this->providerCosts();
        $value = [
            'provider' => $input['provider'], 'currency' => 'BDT',
            'rates' => array_map(fn ($v) => Money::round((string) $v, 4), array_intersect_key($input['rates'], array_flip(self::RATE_KEYS))),
            'effectiveFrom' => $input['effectiveFrom'], 'source' => $input['source'],
            'updatedAt' => Dhaka::iso(now()), 'updatedById' => $admin->userId,
        ];
        DB::transaction(function () use ($admin, $value, $before, $reason) {
            $this->settings->set(self::COST_KEY, $value, $admin->userId);
            $this->audit->log('pricing.provider_costs.update', $admin->actor(), null, 'setting', self::COST_KEY, [
                'before' => $before ? ['provider' => $before['provider'], 'rates' => $before['rates'], 'effectiveFrom' => $before['effectiveFrom']] : null,
                'after' => ['provider' => $value['provider'], 'rates' => $value['rates'], 'effectiveFrom' => $value['effectiveFrom']],
                'source' => $value['source'], 'reason' => $reason,
            ], $admin->ip, $admin->userAgent);
        });
        $this->settings->clearCache();

        return $value;
    }

    // ─── Margins (estimates) ───

    private const GROUPS = [
        'organization' => ['m.organizationId', 'o.name'],
        'plan' => ['o.pricingPlanId', 'p.name'],
        'campaign' => ['m.campaignId', 'c.name'],
        'day' => [null, null],
    ];

    /** SQL fragment: configured wholesale rate of a message, or NULL when no rate is configured. */
    private function rateCase(?array $costs): array
    {
        if (! $costs) {
            return ['NULL', []];
        }
        $r = $costs['rates'];

        return ["(CASE WHEN m.smsType = 'TRANSACTIONAL' AND m.senderType = 'MASKING' THEN ?
            WHEN m.smsType = 'TRANSACTIONAL' THEN ? WHEN m.senderType = 'MASKING' THEN ? ELSE ? END)",
            [$r['transactionalMasking'] ?? '0', $r['transactionalNonMasking'] ?? '0', $r['promotionalMasking'] ?? '0', $r['promotionalNonMasking'] ?? '0']];
    }

    private function marginSelect(?array $costs): array
    {
        [$rate, $bind] = $this->rateCase($costs);

        return ["COUNT(*) AS messages,
            CAST(COALESCE(SUM(CASE WHEN m.refundedAt IS NULL THEN m.cost END), 0) AS CHAR) AS billed,
            CAST(COALESCE(SUM(CASE WHEN m.refundedAt IS NOT NULL THEN m.cost END), 0) AS CHAR) AS refunded,
            COALESCE(SUM(CASE WHEN m.submittedAt IS NOT NULL THEN m.segments END), 0) AS providerSegments,
            CAST(SUM(CASE WHEN m.submittedAt IS NOT NULL THEN m.segments * {$rate} END) AS CHAR) AS estimatedCost", $bind];
    }

    private function shape(object $row): array
    {
        $cost = $row->estimatedCost !== null ? Money::round((string) $row->estimatedCost, 4) : null;

        return [
            'messages' => (int) $row->messages, 'billed' => Money::round($row->billed, 4), 'refunded' => Money::round($row->refunded, 4),
            'providerSegments' => (int) $row->providerSegments, 'estimatedCost' => $cost,
            'estimatedMargin' => $cost !== null ? Money::round(Money::sub($row->billed, $cost), 4) : null,
        ];
    }

    public function marginTotals(DateRange $range): array
    {
        $costs = $this->providerCosts();
        [$select, $bind] = $this->marginSelect($costs);
        $row = DB::selectOne("SELECT {$select} FROM messages m WHERE m.createdAt >= ? AND m.createdAt < ?", [...$bind, self::ts($range->from), self::ts($range->to)]);

        return $this->shape($row) + ['basis' => $costs ? 'estimate' : 'not_configured', 'ratesEffectiveFrom' => $costs['effectiveFrom'] ?? null];
    }

    /** @return array{rows: list<array>, total: int, basis: string} */
    public function margins(DateRange $range, string $groupBy, int $page, int $perPage = 50): array
    {
        $costs = $this->providerCosts();
        [$select, $bind] = $this->marginSelect($costs);
        [$key, $label] = self::GROUPS[$groupBy] ?? self::GROUPS['organization'];
        if ($groupBy === 'day') {
            $key = $label = 'DATE_FORMAT(DATE_ADD(m.createdAt, INTERVAL '.Dhaka::OFFSET_MINUTES.' MINUTE), \'%Y-%m-%d\')';
        }
        $from = 'FROM messages m LEFT JOIN organizations o ON o.id = m.organizationId LEFT JOIN pricing_plans p ON p.id = o.pricingPlanId LEFT JOIN campaigns c ON c.id = m.campaignId
            WHERE m.createdAt >= ? AND m.createdAt < ?';
        $range2 = [self::ts($range->from), self::ts($range->to)];
        $total = (int) DB::scalar("SELECT COUNT(*) FROM (SELECT {$key} AS k {$from} GROUP BY {$key}) g", $range2);
        $rows = DB::select("SELECT {$key} AS groupKey, MAX({$label}) AS label, {$select} {$from} GROUP BY {$key} ORDER BY COALESCE(SUM(CASE WHEN m.refundedAt IS NULL THEN m.cost END), 0) DESC, groupKey LIMIT ? OFFSET ?",
            [...$bind, ...$range2, $perPage, ($page - 1) * $perPage]);

        return [
            'rows' => array_map(fn ($r) => ['key' => $r->groupKey, 'label' => $r->label] + $this->shape($r), $rows),
            'total' => $total, 'basis' => $costs ? 'estimate' : 'not_configured',
        ];
    }
}
