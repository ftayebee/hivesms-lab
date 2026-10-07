<?php

namespace App\Services\Messaging;

use App\Mail\EmailTemplates;
use App\Services\Platform\NotificationService;
use App\Support\Money;
use Illuminate\Support\Facades\DB;

/**
 * One low-balance alert per crossing (port of services/messaging/low-balance.ts): the flag is
 * claimed atomically and reset when a top-up lifts the balance above the threshold.
 */
class LowBalanceService
{
    public function __construct(private readonly NotificationService $notifications) {}

    public function check(string $organizationId): void
    {
        $changed = DB::update(
            'UPDATE wallets SET lowBalanceNotifiedAt = ? WHERE organizationId = ? AND balance < lowBalanceThreshold AND lowBalanceNotifiedAt IS NULL',
            [now()->format('Y-m-d H:i:s.v'), $organizationId],
        );
        if (! $changed) {
            return;
        }
        $row = DB::selectOne('SELECT CAST(balance AS CHAR) AS balance, CAST(lowBalanceThreshold AS CHAR) AS threshold FROM wallets WHERE organizationId = ?', [$organizationId]);
        if (! $row) {
            return;
        }
        $balance = Money::formatBdt($row->balance);
        $threshold = Money::formatBdt($row->threshold);
        $this->notifications->notify(
            $organizationId,
            'balance.low',
            'Low balance',
            "Your balance is {$balance}, below your alert threshold of {$threshold}.",
            '/dashboard/wallet',
            email: fn () => EmailTemplates::lowBalance($balance, $threshold),
        );
    }
}
