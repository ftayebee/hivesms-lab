<?php

namespace App\Services\Messaging;

use App\Exceptions\AppException;
use App\Models\BlocklistEntry;
use App\Models\Message;
use App\Models\Organization;
use App\Models\SuppressionEntry;
use App\Support\Dhaka;
use App\Support\ErrorCode;
use Carbon\CarbonImmutable;

/** Compliance checks applied to every send path (port of services/messaging/compliance.ts). */
class ComplianceService
{
    /** Platform content blocklist (keywords, URL domains). */
    public function assertContentAllowed(string $message): void
    {
        $lower = mb_strtolower($message);
        $entries = BlocklistEntry::query()->whereIn('type', ['KEYWORD', 'URL_DOMAIN'])->get(['type', 'value']);
        foreach ($entries as $e) {
            if ($e->value !== '' && str_contains($lower, mb_strtolower($e->value))) {
                throw new AppException(ErrorCode::CONTENT_BLOCKED, $e->type->value === 'URL_DOMAIN'
                    ? 'The message contains a link to a blocked domain.'
                    : 'The message contains blocked content.');
            }
        }
    }

    /**
     * Numbers blocked platform-wide.
     *
     * @param  list<string>  $phones
     * @return array<string, true>
     */
    public function blockedNumbers(array $phones): array
    {
        $out = [];
        foreach (array_chunk($phones, 5000) as $chunk) {
            foreach (BlocklistEntry::query()->where('type', 'NUMBER')->whereIn('value', $chunk)->pluck('value') as $v) {
                $out[$v] = true;
            }
        }

        return $out;
    }

    /**
     * Organization suppression list (opt-outs, manual suppressions).
     *
     * @param  list<string>  $phones
     * @return array<string, true>
     */
    public function suppressedNumbers(string $organizationId, array $phones): array
    {
        $out = [];
        foreach (array_chunk($phones, 5000) as $chunk) {
            foreach (SuppressionEntry::query()->where('organizationId', $organizationId)->whereIn('phone', $chunk)->pluck('phone') as $p) {
                $out[$p] = true;
            }
        }

        return $out;
    }

    /** @param array<string, mixed> $policy */
    public function isWithinQuietHours(array $policy, ?CarbonImmutable $at = null): bool
    {
        $q = $policy['promotionalQuietHours'] ?? null;
        if (! is_array($q)) {
            return false;
        }
        $hour = Dhaka::hour($at);

        return $q['start'] > $q['end'] ? ($hour >= $q['start'] || $hour < $q['end']) : ($hour >= $q['start'] && $hour < $q['end']);
    }

    /** @param array<string, mixed> $policy */
    public function assertNotQuietHours(array $policy, ?CarbonImmutable $at = null): void
    {
        if ($this->isWithinQuietHours($policy, $at)) {
            $q = $policy['promotionalQuietHours'];
            throw new AppException(ErrorCode::QUIET_HOURS, "Promotional messages cannot be sent between {$q['start']}:00 and {$q['end']}:00 (Asia/Dhaka). Schedule the campaign for a later time.");
        }
    }

    /**
     * Daily/monthly limits. Must run inside the send transaction AFTER locking the wallet row, so
     * concurrent sends of one organization are serialised.
     */
    public function assertWithinSendingLimits(string $organizationId, int $additional): void
    {
        $org = Organization::query()->findOrFail($organizationId, ['id', 'dailySendLimit', 'monthlySendLimit']);
        $today = Message::query()->where('organizationId', $organizationId)->where('createdAt', '>=', Dhaka::startOfDay()->format('Y-m-d H:i:s.v'))->count();
        if ($today + $additional > $org->dailySendLimit) {
            throw new AppException(ErrorCode::DAILY_LIMIT_EXCEEDED, "This send would exceed your daily limit of {$org->dailySendLimit} messages ({$today} sent today). Contact support to raise it.", [
                'limit' => $org->dailySendLimit,
                'used' => $today,
            ]);
        }
        $month = Message::query()->where('organizationId', $organizationId)->where('createdAt', '>=', Dhaka::startOfMonth()->format('Y-m-d H:i:s.v'))->count();
        if ($month + $additional > $org->monthlySendLimit) {
            throw new AppException(ErrorCode::MONTHLY_LIMIT_EXCEEDED, "This send would exceed your monthly limit of {$org->monthlySendLimit} messages. Contact support to raise it.", [
                'limit' => $org->monthlySendLimit,
                'used' => $month,
            ]);
        }
    }
}
