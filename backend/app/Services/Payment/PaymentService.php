<?php

namespace App\Services\Payment;

use App\Exceptions\AppException;
use App\Mail\EmailTemplates;
use App\Models\Invoice;
use App\Models\Payment;
use App\Services\Platform\AuditLogger;
use App\Services\Platform\NotificationService;
use App\Services\Platform\SettingsService;
use App\Services\Wallet\WalletService;
use App\Support\ErrorCode;
use App\Support\Money;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use RuntimeException;

/**
 * Payment completion — the only place that adds purchased credit to a wallet (port of
 * services/billing/payments.ts). Idempotent three times over: the PENDING/AWAITING → SUCCEEDED
 * transition is a conditional update on a row-locked payment, the wallet credit is keyed by
 * (TOPUP, payment, id) in the ledger's unique index, and an invoice is unique per payment. A
 * duplicated webhook therefore can never credit the wallet twice.
 */
class PaymentService
{
    public function __construct(
        private readonly SettingsService $settings,
        private readonly WalletService $wallet,
        private readonly AuditLogger $audit,
        private readonly NotificationService $notifications,
    ) {}

    /** Gap-free counter (MySQL has no sequences). Must run inside the caller's transaction. */
    public static function nextCounterValue(string $name): int
    {
        if (DB::transactionLevel() === 0) {
            throw new \LogicException('Counters must be incremented inside a transaction.');
        }
        if (! DB::update('UPDATE counters SET value = value + 1 WHERE name = ?', [$name])) {
            throw new RuntimeException("Counter \"{$name}\" is missing.");
        }

        return (int) DB::scalar('SELECT value FROM counters WHERE name = ?', [$name]);
    }

    /**
     * @param  array{type: string, userId?: ?string}  $actor
     * @return array{status: 'completed'|'already_completed', payment: Payment}
     */
    public function complete(string $paymentId, array $actor, ?string $providerRef = null, ?string $confirmedAmount = null, ?string $note = null): array
    {
        $policy = $this->settings->billingPolicy();
        $result = DB::transaction(function () use ($paymentId, $actor, $providerRef, $confirmedAmount, $note, $policy) {
            $payment = Payment::query()->with('organization')->lockForUpdate()->find($paymentId);
            if (! $payment) {
                throw new AppException(ErrorCode::NOT_FOUND, 'Payment not found.');
            }
            if ($payment->status->value === 'SUCCEEDED') {
                return ['status' => 'already_completed', 'payment' => $payment];
            }
            if (! in_array($payment->status->value, ['PENDING', 'AWAITING_VERIFICATION'], true)) {
                throw new AppException(ErrorCode::CONFLICT, 'Payment is '.strtolower($payment->status->value).' and cannot be completed.');
            }
            if ($confirmedAmount !== null && $confirmedAmount !== '' && Money::cmp($confirmedAmount, (string) $payment->total) !== 0) {
                throw new AppException(ErrorCode::PAYMENT_FAILED, 'Confirmed amount does not match the expected total.', [
                    'expected' => Money::plain((string) $payment->total),
                    'confirmed' => $confirmedAmount,
                ]);
            }
            $update = ['status' => 'SUCCEEDED', 'completedAt' => now()->format('Y-m-d H:i:s.v')];
            if ($providerRef) {
                $update['providerRef'] = $providerRef;
            }
            if ($actor['type'] === 'ADMIN') {
                $update['reviewedById'] = $actor['userId'];
            }
            $claimed = Payment::query()->whereKey($payment->id)->whereIn('status', ['PENDING', 'AWAITING_VERIFICATION'])->update($update);
            if (! $claimed) {
                return ['status' => 'already_completed', 'payment' => $payment];
            }

            $this->wallet->credit([
                'organizationId' => $payment->organizationId,
                'amount' => (string) $payment->creditAmount,
                'reason' => 'TOPUP',
                'description' => 'Top-up ('.($payment->method ?? $payment->provider).')',
                'referenceType' => 'payment',
                'referenceId' => $payment->id,
                'createdById' => $payment->initiatedById,
            ]);

            $org = $payment->organization;
            $number = $policy['invoicePrefix'].'-'.now()->utc()->format('Y').'-'.str_pad((string) self::nextCounterValue('invoice_number'), 6, '0', STR_PAD_LEFT);
            $lineItems = [['description' => 'SMS wallet top-up', 'quantity' => 1, 'unitPrice' => Money::plain((string) $payment->amount), 'amount' => Money::plain((string) $payment->amount)]];
            if (Money::cmp((string) $payment->creditAmount, (string) $payment->amount) > 0) {
                $lineItems[] = ['description' => 'Package bonus credit (no charge)', 'quantity' => 1, 'unitPrice' => '0', 'amount' => '0'];
            }
            Invoice::query()->forceCreate([
                'organizationId' => $org->id, 'paymentId' => $payment->id, 'number' => $number, 'subtotal' => $payment->amount,
                'vatRate' => $payment->vatRate, 'vatAmount' => $payment->vatAmount, 'total' => $payment->total, 'status' => 'PAID',
                'billingName' => $org->name, 'billingEmail' => $org->billingEmail, 'billingAddress' => $org->address, 'taxId' => $org->taxId,
                'lineItems' => $lineItems, 'issuedAt' => now(),
            ]);
            $this->audit->log('payment.completed', $actor, $org->id, 'payment', $payment->id, [
                'total' => Money::plain((string) $payment->total), 'provider' => $payment->provider, 'note' => $note,
            ]);

            return ['status' => 'completed', 'payment' => Payment::query()->findOrFail($payment->id), 'invoiceNumber' => $number];
        });

        if ($result['status'] === 'completed') {
            /** @var Payment $p */
            $p = $result['payment'];
            $receipt = [
                'invoiceNumber' => $result['invoiceNumber'], 'subtotal' => Money::formatBdt((string) $p->amount), 'vat' => Money::formatBdt((string) $p->vatAmount),
                'total' => Money::formatBdt((string) $p->total), 'credit' => Money::formatBdt((string) $p->creditAmount), 'method' => $p->method ?? $p->provider,
            ];
            $this->notifications->notify($p->organizationId, 'payment.succeeded', 'Payment successful', Money::formatBdt((string) $p->creditAmount).' was added to your wallet.', '/dashboard/wallet', email: fn () => EmailTemplates::paymentReceipt($receipt));
            Log::info('payment completed', ['paymentId' => $p->id, 'org' => $p->organizationId]);
        }

        return ['status' => $result['status'], 'payment' => $result['payment']];
    }

    /** @param array{type: string, userId?: ?string} $actor */
    public function fail(string $paymentId, string $reason, array $actor, string $status = 'FAILED'): bool
    {
        $updated = Payment::query()->whereKey($paymentId)->whereIn('status', ['PENDING', 'AWAITING_VERIFICATION'])
            ->update(['status' => $status, 'failureReason' => mb_substr($reason, 0, 500)]);
        if (! $updated) {
            return false;
        }
        $p = Payment::query()->findOrFail($paymentId);
        $this->audit->log('payment.'.strtolower($status), $actor, $p->organizationId, 'payment', $p->id, ['reason' => $reason]);
        if ($status === 'FAILED') {
            $this->notifications->notify($p->organizationId, 'payment.failed', 'Payment not completed', 'Your payment of '.Money::formatBdt((string) $p->total)." was not completed: {$reason}", '/dashboard/wallet');
        }

        return true;
    }
}
