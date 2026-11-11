<?php

namespace App\Services\Payment;

use App\Auth\AdminContext;
use App\Auth\TenantContext;
use App\Exceptions\AppException;
use App\Models\OrganizationMember;
use App\Models\Payment;
use App\Services\Admin\PrivilegedActionGuard;
use App\Services\Platform\AuditLogger;
use App\Services\Platform\NotificationService;
use App\Services\Platform\SettingsService;
use App\Services\SenderId\DocumentStorage;
use App\Services\Sms\SmsCostCalculator;
use App\Support\Dhaka;
use App\Support\ErrorCode;
use App\Support\Money;
use App\Support\Phone;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Manual wallet top-up requests (docs/22). A request is a `payments` row (provider = manual,
 * metadata.kind = manual_request): no second payment table, and crediting goes through the one
 * existing path, PaymentService::complete() (row lock + conditional status change + unique ledger
 * key (TOPUP, payment, id) + unique invoice) — so it can never credit twice.
 *
 * Status mapping (API "reviewStatus" ⇄ payments.status):
 *   pending ⇄ AWAITING_VERIFICATION · under_review ⇄ UNDER_REVIEW · approved ⇄ SUCCEEDED
 *   rejected ⇄ FAILED · cancelled ⇄ CANCELLED
 *
 * A customer's transaction id or screenshot is a claim, never proof: nothing is credited on
 * submission; a SUPER_ADMIN must re-confirm the received amount and reference (and their password).
 */
class ManualTopUpService
{
    public const STATUS = ['AWAITING_VERIFICATION' => 'pending', 'UNDER_REVIEW' => 'under_review', 'SUCCEEDED' => 'approved', 'FAILED' => 'rejected', 'CANCELLED' => 'cancelled', 'REFUNDED' => 'refunded', 'PENDING' => 'pending'];

    public function __construct(
        private readonly PaymentMethodService $methods,
        private readonly PaymentService $payments,
        private readonly SettingsService $settings,
        private readonly DocumentStorage $storage,
        private readonly AuditLogger $audit,
        private readonly NotificationService $notifications,
        private readonly PrivilegedActionGuard $guard,
    ) {}

    private function base(): Builder
    {
        return Payment::query()->where('provider', 'manual')->whereNotNull('paymentMethodId');
    }

    // ─── Customer ───

    /** @param array<string, mixed> $input validated by the controller */
    public function submit(TenantContext $ctx, array $input, ?UploadedFile $proof): Payment
    {
        $ctx->requirePermission('billing:manage');
        $ctx->assertActive();
        $method = $this->methods->find((string) $input['paymentMethodId'], true);
        $policy = $this->settings->manualPaymentPolicy();
        $billing = $this->settings->billingPolicy();

        $amount = Money::round((string) $input['amount'], 2);
        $min = $method->minAmount !== null ? (string) $method->minAmount : (string) $billing['minimumTopUp'];
        $max = $method->maxAmount !== null ? (string) $method->maxAmount : (string) $billing['maximumTopUp'];
        if (Money::cmp($amount, $min) < 0 || ! Money::isPositive($amount)) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'The minimum for '.$method->displayName.' is BDT '.Money::round($min, 2).'.', ['field' => 'amount']);
        }
        if (Money::cmp($amount, $max) > 0) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'The maximum for '.$method->displayName.' is BDT '.Money::round($max, 2).'.', ['field' => 'amount']);
        }
        $reference = strtoupper(trim((string) $input['transactionId']));
        $senderNumber = null;
        if (! empty($input['senderNumber'])) {
            $senderNumber = Phone::normalize((string) $input['senderNumber']) ?? (preg_match('/^[0-9]{6,20}$/', (string) $input['senderNumber']) ? (string) $input['senderNumber'] : null);
            if ($senderNumber === null) {
                throw new AppException(ErrorCode::VALIDATION_ERROR, 'Enter the number or account you paid from.', ['field' => 'senderNumber']);
            }
        } elseif ($method->requireSenderNumber) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Enter the number you paid from.', ['field' => 'senderNumber']);
        }
        $paidAt = Dhaka::parseLocalInput((string) $input['paidAt']) ?? (strtotime((string) $input['paidAt']) ? CarbonImmutable::parse((string) $input['paidAt'])->utc() : null);
        if (! $paidAt || $paidAt->gt(CarbonImmutable::now()->addMinutes(10)) || $paidAt->lt(CarbonImmutable::now()->subDays(30))) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Enter when you paid (within the last 30 days).', ['field' => 'paidAt']);
        }
        if ($method->requireProof && ! $proof) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Attach a screenshot or PDF of the payment.', ['field' => 'proof']);
        }
        if ($proof && $proof->getSize() > $policy['proofMaxBytes']) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'The proof file is larger than '.round($policy['proofMaxBytes'] / 1048576, 1).' MB.', ['field' => 'proof']);
        }
        $open = $this->base()->where('organizationId', $ctx->organizationId)->whereIn('status', ['AWAITING_VERIFICATION', 'UNDER_REVIEW'])->count();
        if ($open >= $policy['maxOpenRequestsPerOrganization']) {
            throw new AppException(ErrorCode::RATE_LIMITED, 'You already have '.$open.' requests waiting for verification. Wait for them to be reviewed.');
        }
        // The same reference twice from this account: a mistake or a retry — refuse.
        if ($this->base()->where('organizationId', $ctx->organizationId)->where('paymentMethodId', $method->id)->where('manualReference', $reference)->whereNotIn('status', ['FAILED', 'CANCELLED'])->exists()) {
            throw new AppException(ErrorCode::CONFLICT, 'You already submitted this transaction ID.', ['field' => 'transactionId']);
        }
        // Signals for the reviewer (never shown to the customer, never decisive on their own).
        $flags = [];
        if ($this->base()->where('organizationId', '!=', $ctx->organizationId)->where('paymentMethodId', $method->id)->where('manualReference', $reference)->exists()) {
            $flags[] = 'Transaction ID already used by another account';
        }
        if (Money::cmp($amount, (string) $policy['suspiciousAmount']) >= 0) {
            $flags[] = 'Amount at or above the review threshold';
        }
        $rejected = $this->base()->where('organizationId', $ctx->organizationId)->where('status', 'FAILED')->where('createdAt', '>=', now()->subDays(7)->format('Y-m-d H:i:s.v'))->count();
        if ($rejected >= 3) {
            $flags[] = "{$rejected} rejected requests in the last 7 days";
        }

        $breakdown = SmsCostCalculator::topUpBreakdown($amount, (string) $billing['vatRatePercent'], '0');
        $stored = $proof ? $this->storage->store($ctx->organizationId, $proof, 'payment-proofs') : null;
        $payment = Payment::query()->forceCreate([
            'organizationId' => $ctx->organizationId, 'provider' => 'manual', 'paymentMethodId' => $method->id,
            'amount' => $breakdown['subtotal'], 'vatRate' => $breakdown['vatRate'], 'vatAmount' => $breakdown['vatAmount'], 'total' => $breakdown['total'],
            'creditAmount' => $breakdown['creditAmount'], 'method' => $method->displayName, 'manualReference' => $reference,
            'status' => 'AWAITING_VERIFICATION', 'initiatedById' => $ctx->userId,
            'metadata' => [
                'kind' => 'manual_request', 'label' => 'Manual top-up', 'reference' => 'MP-'.strtoupper(Str::random(8)),
                'methodType' => $method->type->value, 'senderNumber' => $senderNumber, 'paidAt' => Dhaka::iso($paidAt),
                'note' => isset($input['note']) ? mb_substr(trim((string) $input['note']), 0, 500) : null,
                'proof' => $stored, 'flags' => $flags, 'internalNotes' => [],
            ],
        ]);
        $this->audit->log('topup_request.submit', $ctx->actor(), $ctx->organizationId, 'payment', $payment->id, [
            'method' => $method->displayName, 'amount' => $breakdown['subtotal'], 'total' => $breakdown['total'], 'proof' => (bool) $stored, 'flags' => $flags,
        ]);
        $ref = $payment->metadata['reference'];
        $this->notifications->notify($ctx->organizationId, 'payment.topup', "Top-up request {$ref} submitted", 'We will add '.Money::formatBdt($breakdown['creditAmount']).' to your wallet after verifying the payment.', '/dashboard/wallet');
        $this->notifications->notifyStaff('staff.payment_request', "Manual payment {$ref}: ".Money::formatBdt($breakdown['total']), "{$method->displayName}, transaction {$reference}.", "/admin/topups/{$payment->id}");
        if ($flags) {
            $this->notifications->notifyStaff('staff.payment_suspicious', "Check manual payment {$ref}", implode('; ', $flags), "/admin/topups/{$payment->id}");
        }

        return $payment;
    }

    public function list(TenantContext $ctx, int $page): LengthAwarePaginator
    {
        $ctx->requirePermission('billing:read');

        return $this->base()->where('organizationId', $ctx->organizationId)->orderByDesc('createdAt')->paginate(20, ['*'], 'page', $page);
    }

    public function owned(TenantContext $ctx, string $id): Payment
    {
        $ctx->requirePermission('billing:read');

        return $this->base()->where('organizationId', $ctx->organizationId)->whereKey($id)->first()
            ?? throw new AppException(ErrorCode::NOT_FOUND, 'Top-up request not found.');
    }

    public function cancel(TenantContext $ctx, string $id): Payment
    {
        $ctx->requirePermission('billing:manage');
        $p = $this->owned($ctx, $id);
        // Only before a reviewer picks it up.
        if (! Payment::query()->whereKey($id)->where('status', 'AWAITING_VERIFICATION')->update(['status' => 'CANCELLED', 'failureReason' => 'Cancelled by the customer'])) {
            throw new AppException(ErrorCode::CONFLICT, 'Only requests that are not yet under review can be cancelled.');
        }
        $this->audit->log('topup_request.cancel', $ctx->actor(), $ctx->organizationId, 'payment', $id);

        return $p->refresh();
    }

    /** @return array{body: string, contentType: string, name: string} */
    public function proof(Payment $p): array
    {
        $proof = $p->metadata['proof'] ?? null;
        $body = is_array($proof) && isset($proof['key']) ? $this->storage->get((string) $proof['key']) : null;
        if ($body === null) {
            throw new AppException(ErrorCode::NOT_FOUND, 'No proof was attached.');
        }

        return ['body' => $body, 'contentType' => (string) $proof['contentType'], 'name' => (string) $proof['name']];
    }

    /** Customer view: no internal notes, flags or storage keys. */
    public static function customerShape(Payment $p): array
    {
        $m = (array) $p->metadata;

        return [
            'id' => $p->id, 'reference' => $m['reference'] ?? null, 'status' => self::STATUS[$p->status->value] ?? strtolower($p->status->value),
            'method' => $p->method, 'methodType' => $m['methodType'] ?? null, 'paymentMethodId' => $p->paymentMethodId,
            'amount' => Money::round((string) $p->amount, 2), 'vatAmount' => Money::round((string) $p->vatAmount, 2), 'total' => Money::round((string) $p->total, 2),
            'creditAmount' => Money::round((string) $p->creditAmount, 2), 'transactionId' => $p->manualReference, 'senderNumber' => $m['senderNumber'] ?? null,
            'paidAt' => $m['paidAt'] ?? null, 'note' => $m['note'] ?? null, 'hasProof' => ! empty($m['proof']['key']),
            'proofName' => $m['proof']['name'] ?? null, 'rejectionReason' => $p->status->value === 'FAILED' ? $p->failureReason : null,
            'adminNote' => $m['review']['customerNote'] ?? null, 'submittedAt' => Dhaka::iso($p->createdAt), 'completedAt' => Dhaka::iso($p->completedAt),
        ];
    }

    // ─── Staff ───

    /** @param array{status?: ?string, from?: ?string, to?: ?string, methodId?: ?string, organizationId?: ?string, q?: ?string} $f */
    public function adminList(array $f, int $page): LengthAwarePaginator
    {
        $status = $f['status'] ?? null;
        $db = array_search($status, ['AWAITING_VERIFICATION' => 'pending', 'UNDER_REVIEW' => 'under_review', 'SUCCEEDED' => 'approved', 'FAILED' => 'rejected', 'CANCELLED' => 'cancelled'], true);

        return $this->base()
            ->with(['organization' => fn ($q) => $q->withTrashed()->select(['id', 'name'])])
            ->when($db, fn ($q) => $q->where('status', $db))
            ->when($f['methodId'] ?? null, fn ($q, $v) => $q->where('paymentMethodId', $v))
            ->when($f['organizationId'] ?? null, fn ($q, $v) => $q->where('organizationId', $v))
            ->when($f['q'] ?? null, fn ($q, $v) => $q->where(fn ($w) => $w->where('manualReference', 'like', '%'.addcslashes(strtoupper($v), '%_\\').'%')
                ->orWhereHas('organization', fn ($o) => $o->where('name', 'like', '%'.addcslashes($v, '%_\\').'%'))))
            ->when($f['from'] ?? null, fn ($q, $v) => $q->where('createdAt', '>=', Dhaka::parseDate($v)?->format('Y-m-d H:i:s.v') ?? '1970-01-01'))
            ->when($f['to'] ?? null, fn ($q, $v) => $q->where('createdAt', '<', Dhaka::parseDate($v)?->addDay()->format('Y-m-d H:i:s.v') ?? '9999-01-01'))
            ->orderByRaw("CASE status WHEN 'AWAITING_VERIFICATION' THEN 0 WHEN 'UNDER_REVIEW' THEN 1 ELSE 2 END")
            ->orderBy('createdAt', in_array($db, ['AWAITING_VERIFICATION', 'UNDER_REVIEW'], true) ? 'asc' : 'desc')
            ->paginate(20, ['*'], 'page', $page);
    }

    public function adminFind(string $id): Payment
    {
        return $this->base()->with(['organization' => fn ($q) => $q->withTrashed()->select(['id', 'name', 'status'])])->whereKey($id)->first()
            ?? throw new AppException(ErrorCode::NOT_FOUND, 'Top-up request not found.');
    }

    public static function adminShape(Payment $p): array
    {
        $m = (array) $p->metadata;

        return self::customerShape($p) + [
            'organization' => $p->relationLoaded('organization') && $p->organization ? ['id' => $p->organization->id, 'name' => $p->organization->name] : null,
            'flags' => array_values((array) ($m['flags'] ?? [])),
            'internalNotes' => array_values((array) ($m['internalNotes'] ?? [])),
            'review' => $m['review'] ?? null,
            'proofContentType' => $m['proof']['contentType'] ?? null,
            'proofSize' => $m['proof']['size'] ?? null,
        ];
    }

    private function audited(AdminContext $admin, string $action, Payment $p, array $meta = []): void
    {
        $this->audit->log($action, $admin->actor(), $p->organizationId, 'payment', $p->id, $meta, $admin->ip, $admin->userAgent);
    }

    /** Staff who belong to the paying organization, or who submitted the request, cannot decide on it. */
    private function assertNotOwnPayment(AdminContext $admin, Payment $p): void
    {
        $member = OrganizationMember::query()->where('organizationId', $p->organizationId)->where('userId', $admin->userId)->exists();
        if ($member || $p->initiatedById === $admin->userId) {
            throw new AppException(ErrorCode::FORBIDDEN, 'You cannot review a payment of an organization you belong to.');
        }
    }

    public function markUnderReview(AdminContext $admin, string $id): Payment
    {
        $p = $this->adminFind($id);
        $this->assertNotOwnPayment($admin, $p);
        if (! Payment::query()->whereKey($id)->where('status', 'AWAITING_VERIFICATION')->update(['status' => 'UNDER_REVIEW', 'reviewedById' => $admin->userId])) {
            throw new AppException(ErrorCode::CONFLICT, 'Only pending requests can be moved to review.');
        }
        $this->audited($admin, 'topup_request.under_review', $p);
        $ref = $p->metadata['reference'] ?? '';
        $this->notifications->notify($p->organizationId, 'payment.topup', "Top-up request {$ref} is under review", 'Our team is verifying your payment.', '/dashboard/wallet');

        return $p->refresh();
    }

    public function addNote(AdminContext $admin, string $id, string $note): Payment
    {
        $note = mb_substr(trim($note), 0, 1000);
        if ($note === '') {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Write a note.', ['field' => 'note']);
        }
        DB::transaction(function () use ($id, $note, $admin) {
            $p = $this->base()->lockForUpdate()->whereKey($id)->firstOrFail();
            $m = (array) $p->metadata;
            $m['internalNotes'][] = ['at' => Dhaka::iso(now()), 'byId' => $admin->userId, 'note' => $note];
            $p->forceFill(['metadata' => $m])->save();
        });
        $p = $this->adminFind($id);
        $this->audited($admin, 'topup_request.note', $p);

        return $p;
    }

    /**
     * Credits the wallet once. The reviewer re-types the amount received and the transaction id
     * they verified on the receiving account; both must match the request. Password re-confirmed.
     */
    public function approve(AdminContext $admin, string $id, string $receivedAmount, string $reference, ?string $note, ?string $password): Payment
    {
        $this->guard->confirm($admin, $password);
        $p = $this->adminFind($id);
        $this->assertNotOwnPayment($admin, $p);
        if (! in_array($p->status->value, ['AWAITING_VERIFICATION', 'UNDER_REVIEW'], true)) {
            throw new AppException(ErrorCode::CONFLICT, $p->status->value === 'SUCCEEDED' ? 'This request was already approved and credited.' : 'This request is no longer pending.');
        }
        if (strtoupper(trim($reference)) !== (string) $p->manualReference) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'The transaction ID does not match the request.', ['field' => 'reference']);
        }
        if (Money::cmp(Money::round($receivedAmount, 2), Money::round((string) $p->total, 2)) !== 0) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'The received amount must equal the request total (BDT '.Money::round((string) $p->total, 2).'). Reject it if a different amount arrived.', ['field' => 'receivedAmount']);
        }
        // providerRef "MANUAL-<method>-<ref>" is unique per provider (DB index): a reference can be credited only once.
        $providerRef = mb_substr('MANUAL-'.$p->paymentMethodId.'-'.$p->manualReference, 0, 255);
        if (Payment::query()->where('provider', 'manual')->where('providerRef', $providerRef)->where('id', '!=', $id)->exists()) {
            throw new AppException(ErrorCode::CONFLICT, 'This transaction ID was already credited to another request. Reject this one.');
        }
        $r = $this->payments->complete($id, $admin->actor(), $providerRef, (string) $p->total, $note ?? 'manual top-up verified');
        if ($r['status'] === 'already_completed') {
            throw new AppException(ErrorCode::CONFLICT, 'This request was already approved and credited.');
        }
        $this->mergeReview($id, ['decision' => 'approved', 'byId' => $admin->userId, 'at' => Dhaka::iso(now()), 'reason' => $note, 'customerNote' => null]);
        $this->audited($admin, 'topup_request.approve', $p, ['total' => Money::round((string) $p->total, 2), 'credit' => Money::round((string) $p->creditAmount, 2), 'note' => $note]);

        return $this->adminFind($id);
    }

    public function reject(AdminContext $admin, string $id, string $reason, ?string $password): Payment
    {
        $this->guard->confirm($admin, $password);
        $reason = mb_substr(trim($reason), 0, 500);
        if ($reason === '') {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Give the customer a reason.', ['field' => 'reason']);
        }
        $p = $this->adminFind($id);
        $this->assertNotOwnPayment($admin, $p);
        // Never credits: only the status changes (conditional, so it cannot undo an approval).
        if (! $this->payments->fail($id, $reason, $admin->actor())) {
            throw new AppException(ErrorCode::CONFLICT, 'This request is no longer pending.');
        }
        Payment::query()->whereKey($id)->update(['reviewedById' => $admin->userId]);
        $this->mergeReview($id, ['decision' => 'rejected', 'byId' => $admin->userId, 'at' => Dhaka::iso(now()), 'reason' => $reason, 'customerNote' => $reason]);
        $this->audited($admin, 'topup_request.reject', $p, ['reason' => $reason]);

        return $this->adminFind($id);
    }

    private function mergeReview(string $id, array $review): void
    {
        DB::transaction(function () use ($id, $review) {
            $p = Payment::query()->lockForUpdate()->findOrFail($id);
            $m = (array) $p->metadata;
            $m['review'] = $review;
            $p->forceFill(['metadata' => $m])->save();
        });
    }
}
