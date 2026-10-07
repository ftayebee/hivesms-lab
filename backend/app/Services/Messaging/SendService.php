<?php

namespace App\Services\Messaging;

use App\Auth\TenantContext;
use App\Exceptions\AppException;
use App\Models\Organization;
use App\Models\SenderId;
use App\Services\Platform\AuditLogger;
use App\Services\Platform\SettingsService;
use App\Services\Sms\MessageSegmentCalculator;
use App\Services\Sms\SmsCostCalculator;
use App\Services\Sms\SmsProviderManager;
use App\Services\Wallet\WalletService;
use App\Support\Dhaka;
use App\Support\ErrorCode;
use App\Support\Money;
use App\Support\Phone;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Accepting messages for sending (port of services/messaging/send.ts), used by the public API and
 * the dashboard quick send:
 *
 *   validate → resolve sender → price → [lock wallet → limits → debit → insert QUEUED messages] → audit
 *
 * The bracket is one database transaction: concurrent requests of one organization are serialised
 * on the wallet row, the debit is conditional (never negative), and messages exist only if the
 * charge committed. Delivery happens asynchronously (DispatcherService); failures are refunded.
 */
class SendService
{
    private const MAX_SCHEDULE_DAYS = 30;

    public function __construct(
        private readonly SettingsService $settings,
        private readonly ComplianceService $compliance,
        private readonly SmsCostCalculator $pricing,
        private readonly WalletService $wallet,
        private readonly RiskEvaluator $risk,
        private readonly AuditLogger $audit,
        private readonly LowBalanceService $lowBalance,
        private readonly SmsProviderManager $providers,
    ) {}

    /**
     * An explicit sender must be an APPROVED sender ID of this organization. Without one: the
     * organization's default approved sender, else the platform's shared non-masking number.
     *
     * @return array{value: string, type: string, id: ?string}
     */
    public function resolveSender(string $organizationId, ?string $requested): array
    {
        if ($requested !== null && $requested !== '') {
            $s = SenderId::query()->where('organizationId', $organizationId)->where('value', $requested)->first(['id', 'value', 'type', 'status']);
            if (! $s || $s->status->value !== 'APPROVED') {
                throw new AppException(ErrorCode::SENDER_ID_NOT_APPROVED, "Sender ID \"{$requested}\" is not approved for this account.");
            }

            return ['value' => $s->value, 'type' => $s->type->value, 'id' => $s->id];
        }
        $def = SenderId::query()->where('organizationId', $organizationId)->where('status', 'APPROVED')->where('isDefault', true)->first(['id', 'value', 'type']);
        if ($def) {
            return ['value' => $def->value, 'type' => $def->type->value, 'id' => $def->id];
        }
        $platform = (string) config('smsflow.sms.default_sender_id');
        if ($platform === '') {
            throw new AppException(ErrorCode::SENDER_ID_NOT_APPROVED, 'No sender ID is available. Request a sender ID first.');
        }

        return ['value' => $platform, 'type' => 'NON_MASKING', 'id' => null];
    }

    /**
     * @param  array{recipients: list<array{phone: string, message?: ?string, variables?: ?array<string, ?string>}>, message: string, senderId?: ?string, smsType: string, source: string, clientReference?: ?string, scheduledAt?: ?CarbonImmutable, mode: 'single'|'bulk'}  $req
     * @return array{batchId: string, accepted: list<array{id: string, to: string, status: string, segments: int, encoding: string, cost: string}>, rejected: list<array{to: string, code: string, reason: string}>, totalCost: string, totalSegments: int, scheduledAt: ?string}
     */
    public function send(TenantContext $ctx, array $req): array
    {
        $ctx->assertActive();
        // Never charge for messages that cannot be sent (e.g. mock provider left on in production).
        $this->providers->sendingProvider();
        $policy = $this->settings->smsPolicy();
        if (! $req['recipients']) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'At least one recipient is required.');
        }
        if (count($req['recipients']) > $policy['maxBulkRecipients']) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, "A single request can include at most {$policy['maxBulkRecipients']} recipients. Use a campaign for larger sends.");
        }
        $scheduledAt = $req['scheduledAt'] ?? null;
        if ($scheduledAt) {
            $ms = $scheduledAt->getTimestampMs() - now()->getTimestampMs();
            if ($ms < -60000) {
                throw new AppException(ErrorCode::VALIDATION_ERROR, 'scheduled_at must be in the future.');
            }
            if ($ms > self::MAX_SCHEDULE_DAYS * 86400000) {
                throw new AppException(ErrorCode::VALIDATION_ERROR, 'scheduled_at can be at most '.self::MAX_SCHEDULE_DAYS.' days ahead.');
            }
        }
        if ($req['smsType'] === 'PROMOTIONAL') {
            $this->compliance->assertNotQuietHours($policy, $scheduledAt ?? CarbonImmutable::now());
        }

        $this->compliance->assertContentAllowed($req['message']);
        $sender = $this->resolveSender($ctx->organizationId, $req['senderId'] ?? null);
        $rate = SmsCostCalculator::rateFor($this->pricing->planFor($ctx->organizationId), $req['smsType'], $sender['type']);

        $rejected = [];
        $reject = function (string $to, ErrorCode $code, string $reason) use ($req, &$rejected) {
            if ($req['mode'] === 'single') {
                throw new AppException($code, $reason);
            }
            $rejected[] = ['to' => $to, 'code' => $code->value, 'reason' => $reason];
        };

        // Normalise, de-duplicate and validate recipients.
        $seen = [];
        $candidates = [];
        foreach ($req['recipients'] as $r) {
            $to = Phone::normalize((string) $r['phone']);
            if ($to === null) {
                $reject((string) $r['phone'], ErrorCode::INVALID_RECIPIENT, 'Not a valid Bangladesh mobile number.');

                continue;
            }
            if (isset($seen[$to])) {
                continue;
            }
            $seen[$to] = true;
            $template = $r['message'] ?? $req['message'];
            if (($r['message'] ?? null) !== null && $r['message'] !== $req['message']) {
                $this->compliance->assertContentAllowed($r['message']);
            }
            $body = isset($r['variables']) && is_array($r['variables']) ? MessageSegmentCalculator::renderTemplate($template, $r['variables']) : $template;
            if (trim($body) === '') {
                $reject($to, ErrorCode::VALIDATION_ERROR, 'Message is empty.');

                continue;
            }
            $candidates[] = ['to' => $to, 'body' => $body];
        }

        $phones = array_column($candidates, 'to');
        $blocked = $this->compliance->blockedNumbers($phones);
        $suppressed = $req['smsType'] === 'PROMOTIONAL' ? $this->compliance->suppressedNumbers($ctx->organizationId, $phones) : [];

        $rows = [];
        $accepted = [];
        $total = '0';
        $totalSegments = 0;
        $now = now()->format('Y-m-d H:i:s.v');
        $nextAttempt = $scheduledAt ? $scheduledAt->format('Y-m-d H:i:s.v') : $now;

        foreach ($candidates as $c) {
            if (isset($blocked[$c['to']])) {
                $reject($c['to'], ErrorCode::INVALID_RECIPIENT, 'This number is blocked on the platform.');

                continue;
            }
            if (isset($suppressed[$c['to']])) {
                $reject($c['to'], ErrorCode::RECIPIENT_SUPPRESSED, 'Recipient has opted out of promotional messages.');

                continue;
            }
            $seg = MessageSegmentCalculator::calculate($c['body'], $policy['segmentation']);
            if ($seg['exceedsMax']) {
                $reject($c['to'], ErrorCode::MESSAGE_TOO_LONG, "Message needs {$seg['segments']} segments; the maximum is {$policy['segmentation']['maxSegments']}.");

                continue;
            }
            $cost = SmsCostCalculator::messageCost($seg['segments'], 1, $rate);
            $id = (string) Str::uuid();
            $rows[] = [
                'id' => $id,
                'organizationId' => $ctx->organizationId,
                'campaignId' => null,
                'apiKeyId' => $ctx->apiKeyId,
                'source' => $req['source'],
                'to' => $c['to'],
                'operator' => Phone::operator($c['to']),
                'senderValue' => $sender['value'],
                'senderType' => $sender['type'],
                'smsType' => $req['smsType'],
                'body' => $c['body'],
                'encoding' => $seg['encoding'],
                'segments' => $seg['segments'],
                'unitPrice' => $rate,
                'cost' => $cost,
                'status' => 'QUEUED',
                'clientReference' => $req['clientReference'] ?? null,
                'attempts' => 0,
                'nextAttemptAt' => $nextAttempt,
                'queuedAt' => $now,
                'createdAt' => $now,
                'updatedAt' => $now,
            ];
            $accepted[] = ['id' => $id, 'to' => $c['to'], 'status' => 'QUEUED', 'segments' => $seg['segments'], 'encoding' => $seg['encoding'], 'cost' => Money::round($cost, 2)];
            $total = Money::add($total, $cost);
            $totalSegments += $seg['segments'];
        }

        if (! $rows) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'No valid recipients to send to.', ['rejected' => $rejected]);
        }

        // Risky large promotional sends must go through a reviewed campaign instead.
        $org = Organization::query()->findOrFail($ctx->organizationId, ['id', 'createdAt']);
        $risk = $this->risk->evaluate($req['message'], $req['smsType'], count($rows), $org->createdAt->diffInSeconds(now()) / 86400);
        if ($risk['action'] === 'review') {
            $this->audit->log('risk.flagged', $ctx->actor(), $ctx->organizationId, metadata: ['reasons' => $risk['reasons'], 'recipients' => count($rows), 'source' => $req['source']]);
            if ($req['smsType'] === 'PROMOTIONAL' && count($rows) > 1) {
                throw new AppException(ErrorCode::CONTENT_BLOCKED, 'This message needs review before sending. Create a campaign so our team can review it.', ['reasons' => $risk['reasons']]);
            }
        }

        $batchId = (string) Str::uuid();
        DB::transaction(function () use ($ctx, $rows, $total, $batchId) {
            $this->wallet->lock($ctx->organizationId);
            $this->compliance->assertWithinSendingLimits($ctx->organizationId, count($rows));
            $this->wallet->debit([
                'organizationId' => $ctx->organizationId,
                'amount' => $total,
                'reason' => 'SMS_CHARGE',
                'description' => count($rows) === 1 ? "SMS to {$rows[0]['to']}" : 'SMS batch ('.count($rows).' recipients)',
                'referenceType' => 'send_batch',
                'referenceId' => $batchId,
                'createdById' => $ctx->userId,
            ]);
            foreach (array_chunk($rows, 500) as $chunk) {
                DB::table('messages')->insert($chunk);
            }
        });

        $this->audit->log('sms.send', $ctx->actor(), $ctx->organizationId, 'send_batch', $batchId, [
            'recipients' => count($rows),
            'rejected' => count($rejected),
            'smsType' => $req['smsType'],
            'source' => $req['source'],
            'cost' => Money::round($total, 2),
        ], $ctx->ip);
        $this->lowBalance->check($ctx->organizationId);

        return [
            'batchId' => $batchId,
            'accepted' => $accepted,
            'rejected' => $rejected,
            'totalCost' => Money::round($total, 2),
            'totalSegments' => $totalSegments,
            'scheduledAt' => $scheduledAt ? Dhaka::iso($scheduledAt) : null,
        ];
    }
}
