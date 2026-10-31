<?php

namespace App\Services\Campaign;

use App\Auth\TenantContext;
use App\Exceptions\AppException;
use App\Models\AuditLog;
use App\Models\Campaign;
use App\Models\CampaignRecipient;
use App\Models\ContactGroup;
use App\Models\Message;
use App\Models\Organization;
use App\Models\Template;
use App\Models\User;
use App\Services\Messaging\ComplianceService;
use App\Services\Messaging\DeliveryService;
use App\Services\Messaging\RiskEvaluator;
use App\Services\Messaging\SendService;
use App\Services\Platform\AuditLogger;
use App\Services\Platform\SettingsService;
use App\Services\Sms\MessageSegmentCalculator;
use App\Services\Sms\SmsProviderManager;
use App\Services\Wallet\WalletService;
use App\Support\Csv;
use App\Support\Dhaka;
use App\Support\ErrorCode;
use App\Support\Money;
use App\Support\Phone;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;

/**
 * Campaign lifecycle for the dashboard (port of features/campaigns/service.ts).
 *
 * Composer input: name, smsType, senderId (value), templateId, message, groupIds, numbers (pasted
 * text), scheduleMode now|later, scheduledAt (Dhaka "YYYY-MM-DDTHH:MM" — what the composer sends —
 * or any ISO-8601 date-time).
 */
class CampaignService
{
    public const PAGE_SIZE = 20;

    private const MAX_PASTED_NUMBERS = 100000;

    public function __construct(
        private readonly SettingsService $settings,
        private readonly ComplianceService $compliance,
        private readonly SendService $send,
        private readonly CampaignRunner $runner,
        private readonly RiskEvaluator $risk,
        private readonly WalletService $wallet,
        private readonly DeliveryService $delivery,
        private readonly AuditLogger $audit,
    ) {}

    /** @param list<string> $ids @return list<string> */
    private function ownedGroups(TenantContext $ctx, array $ids): array
    {
        $ids = array_values(array_unique($ids));
        if (! $ids) {
            return [];
        }
        $found = ContactGroup::query()->where('organizationId', $ctx->organizationId)->whereIn('id', $ids)->pluck('id')->all();
        if (count($found) !== count($ids)) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'One or more selected groups were not found.', ['field' => 'groupIds']);
        }

        return $found;
    }

    private function autoName(array $input): string
    {
        $name = trim((string) ($input['name'] ?? ''));

        return $name !== '' ? $name : (($input['smsType'] === 'PROMOTIONAL' ? 'Promotion' : 'Message').' '.Dhaka::formatDateTime(CarbonImmutable::now()));
    }

    public static function parseScheduledAt(?string $value): ?CarbonImmutable
    {
        if ($value === null || $value === '') {
            return null;
        }
        if ($local = Dhaka::parseLocalInput($value)) {
            // "YYYY-MM-DDTHH:MM" without an offset = Asia/Dhaka wall time (datetime-local input).
            if (! preg_match('/(Z|[+\-]\d{2}:?\d{2})$/', $value)) {
                return $local;
            }
        }
        try {
            return CarbonImmutable::parse($value)->utc();
        } catch (\Throwable) {
            return null;
        }
    }

    private function loadEditable(TenantContext $ctx, string $id): Campaign
    {
        $c = $this->owned($ctx, $id);
        if ($c->status->value !== 'DRAFT') {
            throw new AppException(ErrorCode::CONFLICT, 'Only draft campaigns can be edited.');
        }

        return $c;
    }

    public function owned(TenantContext $ctx, string $id): Campaign
    {
        return Campaign::query()->where('organizationId', $ctx->organizationId)->whereKey($id)->first()
            ?? throw new AppException(ErrorCode::NOT_FOUND, 'Campaign not found.');
    }

    /** Saves a draft (partial content allowed). */
    public function saveDraft(TenantContext $ctx, array $input): Campaign
    {
        $ctx->requirePermission('campaigns:write');
        if (! empty($input['id'])) {
            $this->loadEditable($ctx, $input['id']);
        }
        $groupIds = $this->ownedGroups($ctx, $input['groupIds']);
        $policy = $this->settings->smsPolicy();
        $sender = $this->send->resolveSender($ctx->organizationId, ($input['senderId'] ?? '') ?: null);
        $seg = MessageSegmentCalculator::calculate($input['message'], $policy['segmentation']);
        $data = [
            'name' => $this->autoName($input),
            'smsType' => $input['smsType'],
            'senderIdId' => $sender['id'],
            'senderValue' => $sender['value'],
            'senderType' => $sender['type'],
            'templateId' => $this->ownedTemplateId($ctx, $input['templateId'] ?? null),
            'message' => $input['message'],
            'encoding' => $seg['encoding'],
            'segmentsPerMessage' => max(1, $seg['segments']),
            'audience' => ['groupIds' => $groupIds, 'numbers' => Phone::splitTokens($input['numbers'] ?? '', self::MAX_PASTED_NUMBERS)],
            'scheduledAt' => ($input['scheduleMode'] ?? 'now') === 'later' ? self::parseScheduledAt($input['scheduledAt'] ?? null) : null,
        ];
        if (! empty($input['id'])) {
            $c = $this->owned($ctx, $input['id']);
            $c->forceFill($data)->save();

            return $c;
        }
        $c = Campaign::query()->forceCreate($data + ['organizationId' => $ctx->organizationId, 'status' => 'DRAFT', 'createdById' => $ctx->userId]);
        $this->audit->log('campaign.create', $ctx->actor(), $ctx->organizationId, 'campaign', $c->id);

        return $c;
    }

    private function ownedTemplateId(TenantContext $ctx, ?string $templateId): ?string
    {
        if (! $templateId) {
            return null;
        }

        return Template::query()->where('organizationId', $ctx->organizationId)->whereKey($templateId)->value('id')
            ?? throw new AppException(ErrorCode::VALIDATION_ERROR, 'Template not found.', ['field' => 'templateId']);
    }

    /** @return array<string, mixed> */
    private function validateForSend(TenantContext $ctx, array $input): array
    {
        $policy = $this->settings->smsPolicy();
        if (trim($input['message']) === '') {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Write a message.', ['field' => 'message']);
        }
        $seg = MessageSegmentCalculator::calculate($input['message'], $policy['segmentation']);
        if ($seg['exceedsMax']) {
            throw new AppException(ErrorCode::MESSAGE_TOO_LONG, "The message needs {$seg['segments']} segments; the maximum is {$policy['segmentation']['maxSegments']}.", ['field' => 'message']);
        }
        $this->compliance->assertContentAllowed($input['message']);
        $groupIds = $this->ownedGroups($ctx, $input['groupIds']);
        $numbers = Phone::splitTokens($input['numbers'] ?? '', self::MAX_PASTED_NUMBERS);
        if (! $groupIds && ! $numbers) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Add recipients: select a group or enter numbers.', ['field' => 'numbers']);
        }
        $scheduledAt = null;
        if (($input['scheduleMode'] ?? 'now') === 'later') {
            $scheduledAt = self::parseScheduledAt($input['scheduledAt'] ?? null);
            if (! $scheduledAt) {
                throw new AppException(ErrorCode::VALIDATION_ERROR, 'Choose a date and time.', ['field' => 'scheduledAt']);
            }
            if ($scheduledAt->lt(CarbonImmutable::now()->addMinute())) {
                throw new AppException(ErrorCode::VALIDATION_ERROR, 'Choose a time at least one minute in the future.', ['field' => 'scheduledAt']);
            }
            if ($scheduledAt->gt(CarbonImmutable::now()->addDays(90))) {
                throw new AppException(ErrorCode::VALIDATION_ERROR, 'Schedule at most 90 days ahead.', ['field' => 'scheduledAt']);
            }
        }
        if ($input['smsType'] === 'PROMOTIONAL') {
            $this->compliance->assertNotQuietHours($policy, $scheduledAt ?? CarbonImmutable::now());
        }
        $sender = $this->send->resolveSender($ctx->organizationId, ($input['senderId'] ?? '') ?: null);
        $audience = ['groupIds' => $groupIds, 'numbers' => $numbers];
        $est = $this->runner->estimate($ctx->organizationId, $input['message'], $input['smsType'], $sender['type'], $audience);
        if ($est['included'] === 0) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'None of the recipients can receive this message (all invalid, blocked or opted out).', ['field' => 'numbers']);
        }
        if ($est['total'] > $policy['maxCampaignRecipients']) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Campaigns are limited to '.number_format($policy['maxCampaignRecipients']).' recipients.');
        }
        $org = Organization::query()->findOrFail($ctx->organizationId, ['id', 'requireCampaignReview', 'createdAt']);
        $risk = $this->risk->evaluate($input['message'], $input['smsType'], $est['included'], $org->createdAt->diffInSeconds(now()) / 86400);
        $reasons = $risk['reasons'];
        if ($org->requireCampaignReview && ($input['smsType'] === 'PROMOTIONAL' || $est['included'] > 50)) {
            $reasons[] = "Your account's campaigns are reviewed before sending";
        }
        if ($est['included'] > $policy['reviewThresholdRecipients']) {
            $reasons[] = 'More than '.number_format($policy['reviewThresholdRecipients']).' recipients';
        }

        return ['seg' => $seg, 'sender' => $sender, 'audience' => $audience, 'est' => $est, 'scheduledAt' => $scheduledAt, 'reviewReasons' => $reasons, 'balance' => $this->wallet->balance($ctx->organizationId)];
    }

    /** @return array<string, mixed> */
    public function estimate(TenantContext $ctx, array $input): array
    {
        $ctx->requirePermission(['campaigns:write', 'sms:send']);
        $v = $this->validateForSend($ctx, $input);

        return [
            'total' => $v['est']['total'],
            'included' => $v['est']['included'],
            'skipped' => $v['est']['skipped'],
            'segments' => $v['est']['segments'],
            'encoding' => $v['est']['encoding'],
            'rate' => $v['est']['rate'],
            'estimatedCost' => $v['est']['estimatedCost'],
            'balance' => Money::round($v['balance'], 2),
            'sufficientBalance' => Money::cmp($v['balance'], $v['est']['estimatedCost']) >= 0,
            'requiresReview' => (bool) $v['reviewReasons'],
            'reviewReasons' => $v['reviewReasons'],
            'senderValue' => $v['sender']['value'],
            'senderType' => $v['sender']['type'],
            'scheduledAt' => Dhaka::iso($v['scheduledAt']),
        ];
    }

    /**
     * Submits for sending: SCHEDULED, or PENDING_REVIEW when review is required.
     *
     * @return array{campaign: Campaign, launchNow: bool}
     */
    public function submit(TenantContext $ctx, array $input): array
    {
        $ctx->requirePermission(['campaigns:write', 'sms:send']);
        $ctx->assertActive();
        app(SmsProviderManager::class)->sendingProvider();
        if (! empty($input['id'])) {
            $this->loadEditable($ctx, $input['id']);
        }
        $v = $this->validateForSend($ctx, $input);
        if (Money::cmp($v['balance'], $v['est']['estimatedCost']) < 0) {
            throw new AppException(ErrorCode::INSUFFICIENT_BALANCE, "This campaign needs about BDT {$v['est']['estimatedCost']}; your balance is BDT ".Money::round($v['balance'], 2).'. Add balance and try again.');
        }
        $status = $v['reviewReasons'] ? 'PENDING_REVIEW' : 'SCHEDULED';
        $data = [
            'name' => $this->autoName($input),
            'smsType' => $input['smsType'],
            'senderIdId' => $v['sender']['id'],
            'senderValue' => $v['sender']['value'],
            'senderType' => $v['sender']['type'],
            'templateId' => $this->ownedTemplateId($ctx, $input['templateId'] ?? null),
            'message' => $input['message'],
            'encoding' => $v['seg']['encoding'],
            'segmentsPerMessage' => $v['seg']['segments'],
            'audience' => $v['audience'],
            'scheduledAt' => $v['scheduledAt'],
            'status' => $status,
            'estimatedCost' => $v['est']['estimatedCost'],
            'recipientCount' => $v['est']['included'],
            'reviewNote' => $v['reviewReasons'] ? implode('; ', $v['reviewReasons']) : null,
        ];
        $campaign = DB::transaction(function () use ($ctx, $input, $data) {
            if (! empty($input['id'])) {
                // Conditional: a concurrent double-submit of the same draft creates no second campaign.
                $updated = Campaign::query()->where('organizationId', $ctx->organizationId)->whereKey($input['id'])->where('status', 'DRAFT')->lockForUpdate()->first();
                if (! $updated) {
                    throw new AppException(ErrorCode::CONFLICT, 'Only draft campaigns can be edited.');
                }
                $updated->forceFill($data)->save();

                return $updated;
            }

            return Campaign::query()->forceCreate($data + ['organizationId' => $ctx->organizationId, 'createdById' => $ctx->userId]);
        });
        $this->audit->log($status === 'PENDING_REVIEW' ? 'campaign.submit_for_review' : 'campaign.schedule', $ctx->actor(), $ctx->organizationId, 'campaign', $campaign->id, [
            'recipients' => $v['est']['included'], 'estimatedCost' => $v['est']['estimatedCost'], 'scheduledAt' => Dhaka::iso($v['scheduledAt']), 'reasons' => $v['reviewReasons'],
        ]);

        return ['campaign' => $campaign, 'launchNow' => $status === 'SCHEDULED' && ! $v['scheduledAt']];
    }

    public function pause(TenantContext $ctx, string $id): void
    {
        $ctx->requirePermission('campaigns:write');
        $this->owned($ctx, $id);
        if (! Campaign::query()->whereKey($id)->where('status', 'PROCESSING')->update(['status' => 'PAUSED', 'pausedAt' => now()->format('Y-m-d H:i:s.v')])) {
            throw new AppException(ErrorCode::CONFLICT, 'Only campaigns that are sending can be paused.');
        }
        $this->audit->log('campaign.pause', $ctx->actor(), $ctx->organizationId, 'campaign', $id);
    }

    public function resume(TenantContext $ctx, string $id): void
    {
        $ctx->requirePermission('campaigns:write');
        $ctx->assertActive();
        $this->owned($ctx, $id);
        if (! Campaign::query()->whereKey($id)->where('status', 'PAUSED')->update(['status' => 'PROCESSING', 'pausedAt' => null])) {
            throw new AppException(ErrorCode::CONFLICT, 'Only paused campaigns can be resumed.');
        }
        $this->audit->log('campaign.resume', $ctx->actor(), $ctx->organizationId, 'campaign', $id);
    }

    public function cancel(TenantContext $ctx, string $id): void
    {
        $ctx->requirePermission('campaigns:write');
        $c = $this->owned($ctx, $id);
        $changed = Campaign::query()->whereKey($id)->whereIn('status', ['DRAFT', 'PENDING_REVIEW', 'SCHEDULED', 'PROCESSING', 'PAUSED'])
            ->update(['status' => 'CANCELLED', 'cancelledAt' => now()->format('Y-m-d H:i:s.v')]);
        if (! $changed) {
            throw new AppException(ErrorCode::CONFLICT, 'A '.strtolower($c->status->value).' campaign cannot be cancelled.');
        }
        $this->audit->log('campaign.cancel', $ctx->actor(), $ctx->organizationId, 'campaign', $id, ['from' => $c->status->value]);
        // Unsent messages are cancelled and refunded; large remainders are finished by the worker.
        $this->delivery->cancelQueuedOfCampaign($id, 500);
    }

    /**
     * Retries a campaign that FAILED at launch. A launch failure rolls back before anything is
     * charged or queued, so only campaigns without messages qualify; the launch re-runs every check
     * (organization status, sender approval, balance, sending limits). Review is not bypassed: only
     * a campaign that had reached SCHEDULED can have failed at launch.
     */
    public function retry(TenantContext $ctx, string $id): Campaign
    {
        $ctx->requirePermission(['campaigns:write', 'sms:send']);
        $ctx->assertActive();
        $c = $this->owned($ctx, $id);
        if ($c->status->value !== 'FAILED' || Message::query()->where('campaignId', $id)->exists()) {
            throw new AppException(ErrorCode::CONFLICT, 'Only campaigns that failed before sending can be retried. Duplicate it instead.');
        }
        $changed = Campaign::query()->whereKey($id)->where('status', 'FAILED')
            ->update(['status' => 'SCHEDULED', 'scheduledAt' => null, 'failureReason' => null, 'completedAt' => null, 'startedAt' => null]);
        if (! $changed) {
            throw new AppException(ErrorCode::CONFLICT, 'This campaign can no longer be retried.');
        }
        $this->audit->log('campaign.retry', $ctx->actor(), $ctx->organizationId, 'campaign', $id);

        return $c->refresh();
    }

    /** Composer input rebuilt from a stored draft (send/schedule without resending the content). */
    public function draftInput(TenantContext $ctx, string $id): array
    {
        $c = $this->loadEditable($ctx, $id);
        $a = (array) $c->audience;

        return [
            'id' => $c->id,
            'name' => $c->name,
            'smsType' => $c->smsType->value,
            'senderId' => $c->senderIdId ? $c->senderValue : '',
            'templateId' => $c->templateId,
            'message' => $c->message,
            'groupIds' => array_values((array) ($a['groupIds'] ?? [])),
            'numbers' => implode("\n", (array) ($a['numbers'] ?? [])),
            'scheduleMode' => $c->scheduledAt ? 'later' : 'now',
            'scheduledAt' => $c->scheduledAt ? Dhaka::iso($c->scheduledAt) : '',
        ];
    }

    public function duplicate(TenantContext $ctx, string $id): Campaign
    {
        $ctx->requirePermission('campaigns:write');
        $c = $this->owned($ctx, $id);
        $copy = Campaign::query()->forceCreate([
            'organizationId' => $ctx->organizationId,
            'name' => mb_substr("{$c->name} (copy)", 0, 120),
            'smsType' => $c->smsType->value, 'senderIdId' => $c->senderIdId, 'senderValue' => $c->senderValue, 'senderType' => $c->senderType->value,
            'templateId' => $c->templateId, 'message' => $c->message, 'encoding' => $c->encoding->value, 'segmentsPerMessage' => $c->segmentsPerMessage,
            'audience' => $c->audience, 'status' => 'DRAFT', 'createdById' => $ctx->userId,
        ]);
        $this->audit->log('campaign.duplicate', $ctx->actor(), $ctx->organizationId, 'campaign', $copy->id, ['from' => $id]);

        return $copy;
    }

    public function delete(TenantContext $ctx, string $id): void
    {
        $ctx->requirePermission('campaigns:write');
        $c = $this->owned($ctx, $id);
        if (! in_array($c->status->value, ['DRAFT', 'CANCELLED'], true)) {
            throw new AppException(ErrorCode::CONFLICT, 'Only drafts and cancelled campaigns can be deleted.');
        }
        $c->delete();
        $this->audit->log('campaign.delete', $ctx->actor(), $ctx->organizationId, 'campaign', $id);
    }

    // ─── Queries ───

    /** @return array{page: LengthAwarePaginator, statusCounts: array<string, int>} */
    public function list(TenantContext $ctx, array $q): array
    {
        $ctx->requirePermission('campaigns:read');
        $page = Campaign::query()
            ->where('organizationId', $ctx->organizationId)
            ->when($q['q'] ?? null, fn ($w, $s) => $w->where('name', 'like', '%'.addcslashes($s, '%_\\').'%'))
            ->when($q['status'] ?? null, fn ($w, $s) => $w->where('status', $s))
            ->when($q['type'] ?? null, fn ($w, $s) => $w->where('smsType', $s))
            ->orderByDesc('createdAt')
            ->paginate(self::PAGE_SIZE, ['*'], 'page', $q['page'] ?? 1);
        $counts = Campaign::query()->where('organizationId', $ctx->organizationId)->groupBy('status')->selectRaw('status, COUNT(*) AS n')->pluck('n', 'status')->map(fn ($n) => (int) $n)->all();

        return ['page' => $page, 'statusCounts' => $counts];
    }

    /** @return array<string, mixed> */
    public function detail(TenantContext $ctx, string $id): array
    {
        $ctx->requirePermission('campaigns:read');
        $c = Campaign::query()->with('template:id,name')->where('organizationId', $ctx->organizationId)->whereKey($id)->first()
            ?? throw new AppException(ErrorCode::NOT_FOUND, 'Campaign not found.');
        $status = Message::query()->where('campaignId', $id)->groupBy('status')->selectRaw('status, COUNT(*) AS n')->pluck('n', 'status')->map(fn ($n) => (int) $n);
        $by = fn (array $s) => array_sum(array_map(fn ($k) => $status[$k] ?? 0, $s));
        $failures = DB::select("SELECT COALESCE(errorMessage, 'Unknown') AS reason, COUNT(*) AS n FROM messages WHERE campaignId = ? AND status IN ('FAILED','REJECTED','EXPIRED','CANCELLED') GROUP BY 1 ORDER BY n DESC LIMIT 8", [$id]);
        $operators = DB::select("SELECT operator, COUNT(*) AS total, COUNT(CASE WHEN status = 'DELIVERED' THEN 1 END) AS delivered FROM messages WHERE campaignId = ? GROUP BY operator ORDER BY total DESC", [$id]);
        $timeline = AuditLog::query()->with('actor:id,name')->where('organizationId', $ctx->organizationId)->where('targetType', 'campaign')->where('targetId', $id)->orderBy('createdAt')->get();
        $skips = CampaignRecipient::query()->where('campaignId', $id)->where('status', '!=', 'INCLUDED')->groupBy('status')->selectRaw('status, COUNT(*) AS n')->pluck('n', 'status')->map(fn ($n) => (int) $n)->all();
        $creator = $c->createdById ? User::withTrashed()->whereKey($c->createdById)->value('name') : null;

        return [
            'campaign' => $c,
            'createdBy' => $creator,
            'stats' => [
                'queued' => $by(['QUEUED']), 'sent' => $by(['SUBMITTED']), 'delivered' => $by(['DELIVERED']),
                'failed' => $by(['FAILED', 'REJECTED', 'EXPIRED', 'CANCELLED']), 'total' => array_sum($status->all()),
            ],
            'skipped' => $skips,
            'failures' => array_map(fn ($f) => ['reason' => $f->reason, 'count' => (int) $f->n], $failures),
            'operators' => array_map(fn ($o) => ['operator' => $o->operator ?? 'Unknown', 'total' => (int) $o->total, 'delivered' => (int) $o->delivered], $operators),
            'timeline' => $timeline->map(fn (AuditLog $t) => [
                'id' => $t->id, 'action' => $t->action, 'at' => Dhaka::iso($t->createdAt),
                'actor' => $t->actor?->name ?? ($t->actorType->value === 'SYSTEM' ? 'System' : ($t->actorType->value === 'ADMIN' ? 'Review team' : null)),
                'metadata' => $t->metadata,
            ])->all(),
        ];
    }

    public function messages(TenantContext $ctx, string $id, ?string $status, int $page, int $pageSize): LengthAwarePaginator
    {
        $ctx->requirePermission('campaigns:read');
        $this->owned($ctx, $id);

        return Message::query()->where('organizationId', $ctx->organizationId)->where('campaignId', $id)
            ->when($status, fn ($q, $s) => $q->where('status', $s))
            ->orderBy('createdAt')
            ->paginate($pageSize, ['id', 'to', 'status', 'segments', 'cost', 'errorMessage', 'submittedAt', 'deliveredAt', 'failedAt', 'operator', 'refundedAt'], 'page', $page);
    }

    /** Streams the per-recipient campaign report as CSV. Returns the campaign name. */
    public function exportReport(TenantContext $ctx, string $id, callable $write): string
    {
        $ctx->requirePermission('reports:export');
        $c = $this->owned($ctx, $id);
        $write(Csv::bom().Csv::line(['phone', 'status', 'operator', 'segments', 'cost_bdt', 'refunded', 'error', 'queued_at', 'submitted_at', 'delivered_at', 'failed_at', 'message_id']));
        Message::query()->where('organizationId', $ctx->organizationId)->where('campaignId', $id)
            ->select(['id', 'to', 'status', 'operator', 'segments', 'cost', 'refundedAt', 'errorMessage', 'queuedAt', 'submittedAt', 'deliveredAt', 'failedAt'])
            ->chunkById(5000, function ($rows) use ($write) {
                $out = '';
                foreach ($rows as $m) {
                    $out .= Csv::line([$m->to, $m->status->value, $m->operator, $m->segments, Money::round((string) $m->cost, 2), $m->refundedAt ? 'yes' : 'no', $m->errorMessage, $m->queuedAt, $m->submittedAt, $m->deliveredAt, $m->failedAt, $m->id]);
                }
                $write($out);
            });
        CampaignRecipient::query()->where('campaignId', $id)->where('status', '!=', 'INCLUDED')->select(['id', 'phone', 'status'])
            ->chunkById(5000, function ($rows) use ($write) {
                $out = '';
                foreach ($rows as $s) {
                    $out .= Csv::line([$s->phone, $s->status->value, '', 0, '0.00', 'no', 'Not sent', '', '', '', '', '']);
                }
                $write($out);
            });
        $this->audit->log('campaign.export', $ctx->actor(), $ctx->organizationId, 'campaign', $id);

        return $c->name;
    }
}
