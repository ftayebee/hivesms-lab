<?php

namespace App\Services\Campaign;

use App\Exceptions\AppException;
use App\Mail\EmailTemplates;
use App\Models\Campaign;
use App\Models\Contact;
use App\Models\Message;
use App\Models\Organization;
use App\Models\SenderId;
use App\Services\Messaging\ComplianceService;
use App\Services\Messaging\LowBalanceService;
use App\Services\Messaging\OutboundWebhookService;
use App\Services\Platform\AuditLogger;
use App\Services\Platform\NotificationService;
use App\Services\Platform\SettingsService;
use App\Services\Sms\MessageSegmentCalculator;
use App\Services\Sms\SmsCostCalculator;
use App\Services\Sms\SmsProviderManager;
use App\Services\Wallet\WalletService;
use App\Support\ErrorCode;
use App\Support\Money;
use App\Support\Phone;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Throwable;

/**
 * Campaign execution (port of services/messaging/campaign-runner.ts): audience resolution, cost
 * estimate, launch (one wallet charge for the whole campaign, then queued messages) and
 * finalisation.
 */
class CampaignRunner
{
    public function __construct(
        private readonly SettingsService $settings,
        private readonly ComplianceService $compliance,
        private readonly SmsCostCalculator $pricing,
        private readonly WalletService $wallet,
        private readonly AuditLogger $audit,
        private readonly NotificationService $notifications,
        private readonly OutboundWebhookService $webhooks,
        private readonly LowBalanceService $lowBalance,
        private readonly SmsProviderManager $providers,
    ) {}

    /**
     * Groups + pasted numbers → de-duplicated recipients of one organization, marking who is
     * skipped (opted-out/suppressed for promotional, blocked, invalid).
     *
     * @param  array{groupIds?: list<string>, numbers?: list<string>}  $audience
     * @return list<array{phone: string, contactId: ?string, variables: array<string, string>, status: string}>
     */
    public function resolveAudience(string $organizationId, array $audience, string $smsType): array
    {
        $members = [];
        $seen = [];

        $groupIds = array_values(array_filter((array) ($audience['groupIds'] ?? []), 'is_string'));
        if ($groupIds) {
            Contact::query()
                ->where('organizationId', $organizationId)
                ->whereHas('groups', fn ($q) => $q->whereIn('groupId', $groupIds)->whereHas('group', fn ($g) => $g->where('organizationId', $organizationId)))
                ->select(['id', 'phone', 'name', 'company', 'email', 'consentStatus', 'customFields'])
                ->chunkById(5000, function ($contacts) use (&$members, &$seen, $smsType) {
                    foreach ($contacts as $c) {
                        if (isset($seen[$c->phone])) {
                            continue;
                        }
                        $seen[$c->phone] = true;
                        $custom = [];
                        foreach ((array) ($c->customFields ?? []) as $k => $v) {
                            $custom[(string) $k] = is_scalar($v) ? (string) $v : '';
                        }
                        $members[] = [
                            'phone' => $c->phone,
                            'contactId' => $c->id,
                            'variables' => array_merge($custom, ['name' => $c->name ?? '', 'company' => $c->company ?? '', 'email' => $c->email ?? '', 'phone' => $c->phone]),
                            'status' => $smsType === 'PROMOTIONAL' && $c->consentStatus->value === 'OPTED_OUT' ? 'SKIPPED_SUPPRESSED' : 'INCLUDED',
                        ];
                    }
                });
        }

        foreach ((array) ($audience['numbers'] ?? []) as $raw) {
            $phone = Phone::normalize((string) $raw);
            if ($phone === null) {
                $members[] = ['phone' => mb_substr((string) $raw, 0, 32), 'contactId' => null, 'variables' => [], 'status' => 'SKIPPED_INVALID'];

                continue;
            }
            if (isset($seen[$phone])) {
                continue;
            }
            $seen[$phone] = true;
            $members[] = ['phone' => $phone, 'contactId' => null, 'variables' => ['phone' => $phone], 'status' => 'INCLUDED'];
        }

        $included = array_values(array_map(fn ($m) => $m['phone'], array_filter($members, fn ($m) => $m['status'] === 'INCLUDED')));
        $blocked = $this->compliance->blockedNumbers($included);
        $suppressed = $smsType === 'PROMOTIONAL' ? $this->compliance->suppressedNumbers($organizationId, $included) : [];
        foreach ($members as &$m) {
            if ($m['status'] !== 'INCLUDED') {
                continue;
            }
            if (isset($blocked[$m['phone']])) {
                $m['status'] = 'SKIPPED_BLOCKED';
            } elseif (isset($suppressed[$m['phone']])) {
                $m['status'] = 'SKIPPED_SUPPRESSED';
            }
        }
        unset($m);

        return $members;
    }

    /**
     * Cost estimate before launch (personalised messages may vary slightly).
     *
     * @return array{total: int, included: int, skipped: int, segments: int, encoding: string, rate: string, estimatedCost: string}
     */
    public function estimate(string $organizationId, string $message, string $smsType, string $senderType, array $audience): array
    {
        $policy = $this->settings->smsPolicy();
        $members = $this->resolveAudience($organizationId, $audience, $smsType);
        $included = count(array_filter($members, fn ($m) => $m['status'] === 'INCLUDED'));
        $rate = SmsCostCalculator::rateFor($this->pricing->planFor($organizationId), $smsType, $senderType);
        $seg = MessageSegmentCalculator::calculate($message, $policy['segmentation']);

        return [
            'total' => count($members),
            'included' => $included,
            'skipped' => count($members) - $included,
            'segments' => $seg['segments'],
            'encoding' => $seg['encoding'],
            'rate' => Money::round($rate, 4),
            'estimatedCost' => Money::round(SmsCostCalculator::messageCost($seg['segments'], $included, $rate), 2),
        ];
    }

    /**
     * Launches a SCHEDULED campaign that is due. Claims it atomically (SCHEDULED → PROCESSING) so
     * two workers never launch the same campaign — the wallet is charged exactly once.
     *
     * @return array{launched: bool, messages?: int, error?: string}
     */
    public function launch(string $campaignId): array
    {
        // Not claimed (stays SCHEDULED, nothing charged) while sending is unavailable.
        if (! $this->providers->sendingAvailable()) {
            return ['launched' => false, 'error' => 'SMS sending is unavailable'];
        }
        $now = now()->format('Y-m-d H:i:s.v');
        $claimed = Campaign::query()->whereKey($campaignId)->where('status', 'SCHEDULED')
            ->where(fn ($q) => $q->whereNull('scheduledAt')->orWhere('scheduledAt', '<=', $now))
            ->update(['status' => 'PROCESSING', 'startedAt' => $now]);
        if (! $claimed) {
            return ['launched' => false];
        }
        $campaign = Campaign::query()->findOrFail($campaignId);

        try {
            $policy = $this->settings->smsPolicy();
            $org = Organization::query()->findOrFail($campaign->organizationId);
            if ($org->status->value !== 'ACTIVE') {
                throw new AppException(ErrorCode::ACCOUNT_SUSPENDED, 'Account is suspended.');
            }
            if ($campaign->senderIdId) {
                $sender = SenderId::query()->whereKey($campaign->senderIdId)->where('organizationId', $org->id)->first(['id', 'status']);
                if (! $sender || $sender->status->value !== 'APPROVED') {
                    throw new AppException(ErrorCode::SENDER_ID_NOT_APPROVED, "The campaign's sender ID is no longer approved.");
                }
            }

            $members = $this->resolveAudience($org->id, (array) $campaign->audience, $campaign->smsType->value);
            if (count($members) > $policy['maxCampaignRecipients']) {
                throw new AppException(ErrorCode::VALIDATION_ERROR, "Campaigns are limited to {$policy['maxCampaignRecipients']} recipients.");
            }
            $rate = SmsCostCalculator::rateFor($this->pricing->planFor($org->id), $campaign->smsType->value, $campaign->senderType->value);
            $optOut = $campaign->smsType->value === 'PROMOTIONAL' && $policy['appendOptOutText'] ? "\n".$policy['promotionalOptOutText'] : '';

            $recipientRows = [];
            $messageRows = [];
            $total = '0';
            foreach ($members as $m) {
                if ($m['status'] !== 'INCLUDED') {
                    $recipientRows[] = $this->recipientRow($campaignId, $m, $m['status'], null, $now);

                    continue;
                }
                $body = MessageSegmentCalculator::renderTemplate($campaign->message, $m['variables']).$optOut;
                $seg = MessageSegmentCalculator::calculate($body, $policy['segmentation']);
                if ($seg['exceedsMax'] || trim($body) === '') {
                    $recipientRows[] = $this->recipientRow($campaignId, $m, 'SKIPPED_INVALID', null, $now);

                    continue;
                }
                $cost = SmsCostCalculator::messageCost($seg['segments'], 1, $rate);
                $messageId = (string) Str::uuid();
                $messageRows[] = [
                    'id' => $messageId, 'organizationId' => $org->id, 'campaignId' => $campaignId, 'apiKeyId' => null, 'source' => 'CAMPAIGN',
                    'to' => $m['phone'], 'operator' => Phone::operator($m['phone']), 'senderValue' => $campaign->senderValue,
                    'senderType' => $campaign->senderType->value, 'smsType' => $campaign->smsType->value, 'body' => $body,
                    'encoding' => $seg['encoding'], 'segments' => $seg['segments'], 'unitPrice' => $rate, 'cost' => $cost,
                    'status' => 'QUEUED', 'attempts' => 0, 'nextAttemptAt' => $now, 'queuedAt' => $now, 'createdAt' => $now, 'updatedAt' => $now,
                ];
                $recipientRows[] = $this->recipientRow($campaignId, $m, 'INCLUDED', $messageId, $now);
                $total = Money::add($total, $cost);
            }
            if (! $messageRows) {
                throw new AppException(ErrorCode::VALIDATION_ERROR, 'No eligible recipients (all were invalid, blocked or opted out).');
            }

            DB::transaction(function () use ($org, $campaign, $campaignId, $messageRows, $recipientRows, $total) {
                $this->wallet->lock($org->id);
                $this->compliance->assertWithinSendingLimits($org->id, count($messageRows));
                $this->wallet->debit([
                    'organizationId' => $org->id,
                    'amount' => $total,
                    'reason' => 'SMS_CHARGE',
                    'description' => "Campaign \"{$campaign->name}\" (".count($messageRows).' recipients)',
                    'referenceType' => 'campaign',
                    'referenceId' => $campaignId,
                    'createdById' => $campaign->createdById,
                ]);
                foreach (array_chunk($messageRows, 1000) as $chunk) {
                    DB::table('messages')->insert($chunk);
                }
                foreach (array_chunk($recipientRows, 1000) as $chunk) {
                    DB::table('campaign_recipients')->insertOrIgnore($chunk);
                }
                Campaign::query()->whereKey($campaignId)->update([
                    'recipientCount' => count($recipientRows),
                    'skippedCount' => count($recipientRows) - count($messageRows),
                    'queuedCount' => count($messageRows),
                    'actualCost' => $total,
                ]);
            });
            $this->audit->log('campaign.launch', ['type' => 'SYSTEM'], $org->id, 'campaign', $campaignId, [
                'recipients' => count($messageRows), 'skipped' => count($recipientRows) - count($messageRows), 'cost' => Money::round($total, 2),
            ]);
            $this->lowBalance->check($org->id);

            return ['launched' => true, 'messages' => count($messageRows)];
        } catch (Throwable $e) {
            $reason = $e instanceof AppException ? $e->getMessage() : 'Unexpected error while launching the campaign.';
            if (! $e instanceof AppException) {
                Log::error('campaign launch failed', ['campaignId' => $campaignId, 'error' => $e->getMessage()]);
            }
            Campaign::query()->whereKey($campaignId)->update(['status' => 'FAILED', 'failureReason' => $reason, 'completedAt' => now()->format('Y-m-d H:i:s.v')]);
            $this->notifications->notify($campaign->organizationId, 'campaign.failed', "Campaign \"{$campaign->name}\" could not start", $reason, "/dashboard/campaigns/{$campaignId}");

            return ['launched' => false, 'error' => $reason];
        }
    }

    private function recipientRow(string $campaignId, array $m, string $status, ?string $messageId, string $now): array
    {
        return [
            'id' => (string) Str::uuid(),
            'campaignId' => $campaignId,
            'contactId' => $m['contactId'],
            'phone' => $m['phone'],
            'variables' => $status === 'INCLUDED' ? json_encode($m['variables'], JSON_UNESCAPED_UNICODE) : null,
            'status' => $status,
            'messageId' => $messageId,
            'createdAt' => $now,
        ];
    }

    /** @return list<string> ids of due SCHEDULED campaigns (oldest first) */
    public function dueCampaignIds(int $limit = 5): array
    {
        return Campaign::query()
            ->where('status', 'SCHEDULED')
            ->where(fn ($q) => $q->whereNull('scheduledAt')->orWhere('scheduledAt', '<=', now()->format('Y-m-d H:i:s.v')))
            ->orderBy('scheduledAt')
            ->limit($limit)
            ->pluck('id')
            ->all();
    }

    /** Marks PROCESSING campaigns COMPLETED once nothing is left in the queue. */
    public function finalize(): int
    {
        $completed = 0;
        $ids = Campaign::query()->where('status', 'PROCESSING')->pluck('id');
        foreach ($ids as $id) {
            if (Message::query()->where('campaignId', $id)->where('status', 'QUEUED')->exists()) {
                continue;
            }
            $done = Campaign::query()->whereKey($id)->where('status', 'PROCESSING')->update(['status' => 'COMPLETED', 'completedAt' => now()->format('Y-m-d H:i:s.v')]);
            if (! $done) {
                continue;
            }
            $completed++;
            $c = Campaign::query()->findOrFail($id);
            $this->webhooks->enqueue($c->organizationId, 'campaign.completed', [
                'campaign_id' => $c->id, 'name' => $c->name, 'recipients' => $c->recipientCount, 'submitted' => $c->submittedCount,
                'delivered' => $c->deliveredCount, 'failed' => $c->failedCount, 'cost' => Money::plain((string) $c->actualCost),
            ]);
            $cost = Money::formatBdt((string) $c->actualCost);
            $this->notifications->notify(
                $c->organizationId,
                'campaign.completed',
                "Campaign \"{$c->name}\" completed",
                "{$c->submittedCount} sent, {$c->deliveredCount} delivered so far, {$c->failedCount} failed.",
                "/dashboard/campaigns/{$c->id}",
                email: fn () => EmailTemplates::campaignCompleted(['name' => $c->name, 'recipients' => $c->recipientCount, 'delivered' => $c->deliveredCount, 'failed' => $c->failedCount, 'cost' => $cost, 'campaignId' => $c->id]),
            );
        }

        return $completed;
    }
}
