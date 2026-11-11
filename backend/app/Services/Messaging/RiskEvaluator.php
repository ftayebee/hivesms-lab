<?php

namespace App\Services\Messaging;

use App\Services\Platform\SettingsService;

/**
 * Abuse-risk heuristics (port of services/risk). Conservative: flags genuinely suspicious
 * campaigns for human review, never silently blocks. Routine campaigns are never held: a large
 * recipient count alone is not a risk signal unless the admin sets risk.holdAboveRecipients.
 * Thresholds come from Admin → Settings → Campaign processing (campaign.processing.risk).
 * Returns ['action' => 'allow'|'review', 'reasons' => [...]].
 */
class RiskEvaluator
{
    public function __construct(private readonly ?SettingsService $settings = null) {}

    private const SHORTENERS = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'is.gd', 'cutt.ly', 'rb.gy', 'shorturl.at', 'tiny.cc'];

    /** @return array{action: 'allow'|'review', reasons: list<string>} */
    public function evaluate(string $message, string $smsType, int $recipientCount, float $organizationAgeDays): array
    {
        $reasons = [];
        $lower = mb_strtolower($message);
        foreach (self::SHORTENERS as $d) {
            if (str_contains($lower, $d)) {
                $reasons[] = 'Contains a URL shortener';
                break;
            }
        }
        if (preg_match('/(https?:\/\/|www\.)[^\s]+/i', $message) && preg_match('/(verify|confirm|update|unlock).{0,40}(account|pin|password|otp|card)/i', $message)) {
            $reasons[] = 'Asks the recipient to verify account details and contains a link';
        }
        $risk = ($this->settings ?? app(SettingsService::class))->campaignProcessing()['risk'];
        if ($organizationAgeDays < $risk['newAccountDays'] && $recipientCount > $risk['newAccountMaxRecipients']) {
            $reasons[] = 'Large send from a new account';
        }
        if ($smsType === 'TRANSACTIONAL' && $risk['transactionalBulkThreshold'] > 0 && $recipientCount > $risk['transactionalBulkThreshold']) {
            $reasons[] = 'Very large transactional batch (transactional traffic is usually one-to-one)';
        }
        if ($risk['holdAboveRecipients'] > 0 && $recipientCount > $risk['holdAboveRecipients']) {
            $reasons[] = 'More than '.number_format($risk['holdAboveRecipients']).' recipients (platform safety limit)';
        }

        return ['action' => $reasons ? 'review' : 'allow', 'reasons' => $reasons];
    }
}
